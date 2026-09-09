/** Subject: the tools `lore mcp` offers, against a fake client. Tier: isolated (no tar, no server). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { LoreClient, ExecResult } from "./client.js";
import { buildTools, workspaceDest, type SpawnTar } from "./mcp-tools.js";

const ok = (stdout = ""): ExecResult => ({ stdout, stderr: "", exit_code: 0, duration_ms: 1, truncated: false });

/** Only the methods the tools reach for. */
function fakeClient(over: Partial<Record<keyof LoreClient, unknown>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec = (method: string, impl: (...a: unknown[]) => unknown) => (...args: unknown[]) => { calls.push({ method, args }); return impl(...args); };
  const client = {
    guide: rec("guide", async () => "the guide"),
    okfSpec: rec("okfSpec", async () => "the spec"),
    createSession: rec("createSession", async () => ({ id: "abc123", branch: "session/abc123", base_commit: "deadbeef" })),
    listSessions: rec("listSessions", async () => []),
    closeSession: rec("closeSession", async (id: unknown) => ({ id })),
    exec: rec("exec", async () => ok("hello\n")),
    execStdin: rec("execStdin", async (_id: unknown, _cmd: unknown, stdin: unknown) => { const chunks: Buffer[] = []; for await (const c of stdin as Readable) chunks.push(c as Buffer); return ok(Buffer.concat(chunks).toString()); }),
    ...over,
  } as unknown as LoreClient;
  return { client, calls };
}

const tool = (tools: ReturnType<typeof buildTools>, name: string) => tools.find((t) => t.name === name)!;

describe("the shared five tools", () => {
  it("declare the same names as the server's /mcp endpoint", () => {
    const names = buildTools({ client: fakeClient().client }).map((t) => t.name);
    for (const n of ["lore_guide", "lore_session_create", "lore_session_list", "lore_session_close", "lore_shell"]) assert.ok(names.includes(n), n);
    assert.ok(names.includes("lore_put"));
  });
  it("create returns the session id in text and structured form", async () => {
    const { client } = fakeClient();
    const r = await tool(buildTools({ client }), "lore_session_create").handler({ purpose: "x" });
    assert.match(r.content[0].text, /session_id: abc123/);
    assert.equal(r.structuredContent?.session_id, "abc123");
  });
  it("shell passes the command through and formats a non-zero exit as a result, not an error", async () => {
    const { client } = fakeClient({ exec: async () => ({ stdout: "", stderr: "no such file", exit_code: 2, duration_ms: 1, truncated: false }) });
    const r = await tool(buildTools({ client }), "lore_shell").handler({ session_id: "s", command: "ls nope" });
    assert.equal(r.isError, false);
    assert.match(r.content[0].text, /--- stderr ---\nno such file/);
    assert.match(r.content[0].text, /exit code 2/);
  });
  it("a transport failure comes back as an error result with the code", async () => {
    const { CliError } = await import("./errors.js");
    const { client } = fakeClient({ exec: async () => { throw new CliError(102, "no such session"); } });
    const r = await tool(buildTools({ client }), "lore_shell").handler({ session_id: "s", command: "true" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /no such session \(transport error 102\)/);
  });
});

describe("lore_put", () => {
  const fakeTar = (payload: string): { spawnTar: SpawnTar; seen: string[][] } => {
    const seen: string[][] = [];
    return { seen, spawnTar: (args) => { seen.push(args); return { stream: Readable.from([Buffer.from(payload)]), done: Promise.resolve(0) }; } };
  };
  it("streams a tar of a directory to tar -x in the destination and reports the count", async () => {
    const { client, calls } = fakeClient();
    const { spawnTar, seen } = fakeTar("TARBYTES");
    const measure = async () => ({ files: 3, bytes: 300, directory: true });
    const r = await tool(buildTools({ client, spawnTar, measure }), "lore_put").handler({ session_id: "s1", source: "/home/me/docs", dest: "customers/acme" });
    assert.deepEqual(seen, [["-c", "-C", "/home/me/docs", "."]]);
    const put = calls.find((c) => c.method === "execStdin")!;
    assert.equal(put.args[0], "s1");
    assert.equal(put.args[1], "mkdir -p -- 'customers/acme' && tar -x -C 'customers/acme'");
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /copied 3 files \(300 bytes\) into \/workspace\/customers\/acme/);
  });
  it("copies a single file by name, into the workspace root by default", async () => {
    const { client, calls } = fakeClient();
    const { spawnTar, seen } = fakeTar("X");
    const measure = async () => ({ files: 1, bytes: 1, directory: false });
    const r = await tool(buildTools({ client, spawnTar, measure }), "lore_put").handler({ session_id: "s1", source: "/home/me/note.md" });
    assert.deepEqual(seen, [["-c", "-C", "/home/me", "note.md"]]);
    assert.equal(calls.find((c) => c.method === "execStdin")!.args[1], "mkdir -p -- '.' && tar -x -C '.'");
    assert.match(r.content[0].text, /copied 1 file \(1 bytes\) into \/workspace$/);
  });
  it("refuses a destination outside the workspace", async () => {
    assert.throws(() => workspaceDest("/etc"), /relative path/);
    assert.throws(() => workspaceDest("../x"), /relative path/);
    assert.equal(workspaceDest(undefined), ".");
    assert.equal(workspaceDest("a/./b/"), "a/b");
  });
  it("reports a failed extraction as an error with the sandbox output", async () => {
    const { client } = fakeClient({ execStdin: async () => ({ stdout: "", stderr: "tar: bad archive", exit_code: 1, duration_ms: 1, truncated: false }) });
    const { spawnTar } = fakeTar("X");
    const measure = async () => ({ files: 1, bytes: 1, directory: false });
    const r = await tool(buildTools({ client, spawnTar, measure }), "lore_put").handler({ session_id: "s1", source: "/tmp/f" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /bad archive/);
  });
});
