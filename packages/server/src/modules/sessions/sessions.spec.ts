/**
 * Subject: the session lifecycle as promised by sessions/README.md and spec 02/03.
 * Tier: stack (declared below). Drives a running orchestrator with real sandboxes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { stackTier, skipReason, freshUser, type Api } from "../../../test/support/stack";

const stack = stackTier();

describe("sessions", { skip: stack ? false : skipReason }, () => {
  let owner: Api; let other: Api; let admin: Api;
  const opened: string[] = [];

  before(async () => {
    owner = (await freshUser(stack!)).api;
    other = (await freshUser(stack!)).api;
    admin = (await freshUser(stack!, { admin: true })).api;
  });
  after(async () => { for (const id of opened) await admin.close(id).catch(() => undefined); });

  const open = async (api: Api, purpose: string) => { const id = await api.createSession(purpose); opened.push(id); return id; };

  it("creates a session whose workspace is a checkout of main on the session branch", async () => {
    const id = await open(owner, "checkout shape");
    const r = await owner.exec(id, "git branch --show-current && git remote get-url origin && test -f AGENTS.md && echo agents-ok");
    assert.equal(r.status, 200);
    assert.equal(r.json.exit_code, 0);
    assert.match(r.json.stdout, new RegExp(`^session/${id}\\n`));
    assert.match(r.json.stdout, /\/git\/loreg_[0-9a-f]+\/knowledge\.git/);
    assert.match(r.json.stdout, /agents-ok/);
  });

  it("runs as an unprivileged user with a read-only root filesystem", async () => {
    const id = await open(owner, "isolation");
    const r = await owner.exec(id, "id -u; touch /usr/bin/x 2>&1; echo exit=$?");
    assert.match(r.json.stdout, /^1000\n/);
    assert.match(r.json.stdout, /[Rr]ead-only file system|Permission denied/); // gVisor reports EACCES, runc EROFS
  });

  it("passes a command's non-zero exit and stderr through as a successful call", async () => {
    const id = await open(owner, "passthrough");
    const r = await owner.exec(id, "cat topics/nope.md");
    assert.equal(r.status, 200);
    assert.equal(r.json.exit_code, 1);
    assert.match(r.json.stderr, /No such file or directory/);
  });

  it("streams stdin into the command, so a tar archive can be unpacked into the workspace", async () => {
    const id = await open(owner, "stdin");
    const r = await owner.execStdin(id, "cat > notes.md && wc -c < notes.md", Buffer.from("hello stdin\n"));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.exit_code, 0);
    assert.equal(r.json.stdin_bytes, 12);
    assert.equal(r.json.stdout.trim(), "12");
  });

  it("reports a command timeout as transport error 103, not as a command result", async () => {
    const id = await open(owner, "timeout");
    const r = await owner.exec(id, "sleep 30", { timeout_ms: 1000 });
    assert.equal(r.status, 504);
    assert.equal(r.json.error.code, 103);
  });

  it("lands a push on main and records it in the audit log", async () => {
    const id = await open(owner, "push");
    const r = await owner.exec(id, `mkdir -p topics/t-${id} && echo "---\ntitle: T\ntype: Topic\n---" > topics/t-${id}/index.md && git add -A && git commit -qm "test ${id}" && git push origin HEAD 2>&1`);
    assert.equal(r.json.exit_code, 0, r.json.stdout + r.json.stderr);
    assert.match(r.json.stdout, /lore: accepted refs\/heads\/session\//);
    assert.match(r.json.stdout, /lore: landed; main is now/);
    const log = await owner.call("GET", `/sessions/${id}/log?format=json`);
    const push = log.json.find((e: any) => e.op === "push");
    assert.equal(push.result, "accepted");
    assert.equal(push.main_after, push.after);
  });

  it("refreshes the browsable checkout of main after a landing", async () => {
    const id = await open(owner, "checkout mirror");
    const marker = `mirror-${id}`;
    const r = await owner.exec(id, `echo ${marker} > ${marker}.md && git add -A && git commit -qm "${marker}" && git push origin HEAD 2>&1 | grep -c landed`);
    assert.equal(r.json.stdout.trim(), "1");
    const dataDir = process.env.LORE_TEST_DATA_DIR;
    const fs = await import("node:fs");
    if (!dataDir || !fs.existsSync(`${dataDir}/main`)) return; // only inspectable when the test runs beside the data directory
    assert.equal(fs.readFileSync(`${dataDir}/main/${marker}.md`, "utf8").trim(), marker);
  });

  it("rejects a direct push to main and a push to another session's branch", async () => {
    const id = await open(owner, "protected");
    await owner.exec(id, "echo x > x.md && git add -A && git commit -qm x");
    const r1 = await owner.exec(id, "git push origin HEAD:main 2>&1; echo exit=$?");
    assert.match(r1.json.stdout, /is not writable/);
    const r2 = await owner.exec(id, "git push origin HEAD:refs/heads/session/zzzzzz 2>&1; echo exit=$?");
    assert.match(r2.json.stdout, /may not push to/);
  });

  it("makes a concurrent edit the agent's problem: reject, merge with conflict markers, push again", async () => {
    const a = await open(owner, "conflict a");
    const b = await open(owner, "conflict b");
    const file = `topics/conflict-${a}.md`;
    const write = (text: string) => `printf -- '---\\ntitle: C\\ntype: Topic\\n---\\n\\n${text}\\n' > ${file} && git add -A && git commit -qm "${text}"`;
    const first = await owner.exec(a, `${write("from a")} && git push origin HEAD 2>&1 | grep -c landed`);
    assert.equal(first.json.stdout.trim(), "1");
    const rejected = await owner.exec(b, `${write("from b")} && git push origin HEAD 2>&1; echo exit=$?`);
    assert.match(rejected.json.stdout, /behind main and would not fast-forward/);
    assert.match(rejected.json.stdout, /exit=1/);
    const merged = await owner.exec(b, `git fetch -q origin && git merge origin/main 2>&1; grep -c '<<<<<<<' ${file}`);
    assert.equal(merged.json.stdout.trim().split("\n").pop(), "1");
    const resolved = await owner.exec(b, `printf -- '---\\ntitle: C\\ntype: Topic\\n---\\n\\nfrom a and b\\n' > ${file} && git add -A && git commit -qm merge && git push origin HEAD 2>&1 | grep -c landed`);
    assert.equal(resolved.json.stdout.trim(), "1");
  });

  it("lets everyone read a session and its log, but only the owner or an admin operate it", async () => {
    const id = await open(owner, "ownership");
    assert.equal((await other.call("GET", `/sessions/${id}`)).status, 200);
    assert.equal((await other.call("GET", `/sessions/${id}/log`)).status, 200);
    const denied = await other.exec(id, "ls");
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 101);
    assert.equal((await other.close(id)).status, 403);
    assert.equal((await admin.exec(id, "true")).json.exit_code, 0);
  });

  it("discards unpushed work on close and records what was lost", async () => {
    const id = await open(owner, "close snapshot");
    await owner.exec(id, "echo draft > draft.md && git add -A && git commit -qm 'unpushed'");
    const closed = await owner.close(id);
    assert.equal(closed.json.state, "closed");
    const log = await owner.call("GET", `/sessions/${id}/log?format=json`);
    const close = log.json.find((e: any) => e.op === "close");
    assert.match(close.unpushed, /unpushed/);
    assert.equal((await owner.exec(id, "ls")).status, 404);
  });

  it("answers an unknown session with 404 and transport code 102", async () => {
    const r = await owner.exec("nope99", "ls");
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 102);
  });
});
