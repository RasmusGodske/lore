/**
 * pre-receive / post-receive hooks for the knowledge repository. Standalone script, no Nest.
 *
 * Spawned by `git receive-pack` under `git http-backend`, inside the orchestrator container.
 * Identity arrives as $REMOTE_USER, set by GitHttpController after validating the per-session
 * token in the URL. See spec 03-git-model.md.
 *
 * pre-receive enforces:
 *   1. Only session branches may be pushed.
 *   2. A session may only push its own branch.
 *   3. No history rewriting on the session branch, no deletion.
 *   4. The pushed commit must contain current main.
 * post-receive fast-forwards main. Git quarantines pushed objects until pre-receive has
 * passed, so main cannot be pointed at them earlier; the orchestrator's push lock makes
 * the two steps race-free. Content is deliberately not validated.
 *
 * With a remote configured (LORE_REMOTE_URL in the environment, passed through by the
 * orchestrator), the remote is the truth: pre-receive first fetches its main and fast-forwards
 * local main to it, checks rule 4 against that, then pushes the commit to the remote and only
 * accepts if the remote took it. Quarantined objects can be pushed as long as the quarantine
 * marker is not passed on to the receiving side.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { checkPush, planLanding, type RefUpdate } from "./hook-rules";

const session = process.env.REMOTE_USER ?? "";
const mode = process.argv[2] ?? "pre-receive";
const remoteUrl = process.env.LORE_REMOTE_URL || "";
const HELPER = '!f() { echo "username=$LORE_REMOTE_USERNAME"; echo "password=$LORE_REMOTE_TOKEN"; }; f';

/** git against the remote: credentials via helper, quarantine marker withheld from the far side. */
function remoteGit(args: string[]): { ok: boolean; out: string; err: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  delete env.GIT_QUARANTINE_PATH;
  try {
    const out = execFileSync("git", ["-c", `credential.helper=${HELPER}`, ...args], { stdio: ["ignore", "pipe", "pipe"], env }).toString().trim();
    return { ok: true, out, err: "" };
  } catch (e) {
    const lines = ((e as { stderr?: Buffer }).stderr?.toString().trim() ?? String(e)).split("\n").map((l) => l.trim()).filter(Boolean);
    // Prefer git's own verdict line over its trailing hints.
    const verdict = lines.find((l) => /\[(remote )?rejected\]/.test(l)) ?? lines.find((l) => /^(fatal|error):/.test(l)) ?? lines.filter((l) => !l.startsWith("hint:")).slice(-1)[0] ?? lines.slice(-1)[0] ?? "unknown error";
    return { ok: false, out: "", err: verdict.replace(/^!\s*/, "") };
  }
}

const git = (args: string[]): { ok: boolean; out: string } => {
  try { return { ok: true, out: execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim() }; }
  catch { return { ok: false, out: "" }; }
};
const isAncestor = (a: string, b: string) => git(["merge-base", "--is-ancestor", a, b]).ok;
const say = (l: string) => process.stderr.write(`lore: ${l}\n`);

const updates: RefUpdate[] = fs.readFileSync(0, "utf8").split("\n").filter(Boolean).map((l) => {
  const [oldSha, newSha, ref] = l.split(" ");
  return { oldSha, newSha, ref };
});
const main = git(["rev-parse", "refs/heads/main"]);

if (mode === "post-receive") {
  for (const u of updates) {
    const plan = planLanding(u, main.ok ? main.out : null, isAncestor);
    if (plan.kind === "skip") continue;
    if (plan.kind === "warn") { say(plan.message); continue; }
    if (git(["update-ref", "refs/heads/main", plan.to, plan.from]).ok) { if (!remoteUrl) say(`landed; main is now ${plan.to.slice(0, 7)}.`); }
    else say("WARNING could not fast-forward main; contact an operator.");
  }
  process.exit(0);
}

// Remote as truth: make local main current before judging, so rule 4 is checked against the
// remote's main and "fetch and merge origin/main" gives the agent the real state.
let mainSha = main.ok ? main.out : null;
if (remoteUrl) {
  const f = remoteGit(["fetch", "--quiet", remoteUrl, "+refs/heads/main:refs/remotes/lore-remote/main"]);
  if (!f.ok && !/couldn't find remote ref|no such ref/i.test(f.err)) {
    say(`could not reach the remote repository (${f.err}); nothing was landed. Try again in a moment.`);
    process.exit(1);
  }
  const remoteMain = f.ok ? git(["rev-parse", "refs/remotes/lore-remote/main"]).out : null;
  if (remoteMain && remoteMain !== mainSha) {
    if (!mainSha || isAncestor(mainSha, remoteMain)) {
      // The remote is ahead (someone edited there): follow it.
      if (git(["update-ref", "refs/heads/main", remoteMain, ...(mainSha ? [mainSha] : [])]).ok) mainSha = remoteMain;
    } else if (!isAncestor(remoteMain, mainSha)) {
      say("the remote repository and this server have diverged; an operator must reconcile them before anything can land.");
      process.exit(1);
    }
    // else: the remote is behind local main; the landing push below carries it forward.
  }
}

const verdict = checkPush({ session, updates, main: mainSha, isAncestor });
if (!verdict.ok) { for (const l of verdict.messages) say(l); process.exit(1); }

// With a remote, the landing is the push to it; only say "accepted" once that has happened.
if (remoteUrl) {
  for (const u of updates) {
    const p = remoteGit(["push", "--quiet", remoteUrl, `${u.newSha}:refs/heads/main`]);
    if (!p.ok) {
      say(`the remote repository refused the landing: ${p.err}`);
      say("run: git fetch origin && git merge origin/main   then commit and push again.");
      process.exit(1);
    }
    git(["update-ref", "refs/remotes/lore-remote/main", u.newSha]);
  }
}
for (const l of verdict.messages) say(l);
if (remoteUrl) for (const u of updates) say(`landed on the remote; main is now ${u.newSha.slice(0, 7)}.`);
process.exit(0);
