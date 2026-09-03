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
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { checkPush, planLanding, type RefUpdate } from "./hook-rules";

const session = process.env.REMOTE_USER ?? "";
const mode = process.argv[2] ?? "pre-receive";

const git = (args: string[]): { ok: boolean; out: string } => {
  try { return { ok: true, out: execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim() }; }
  catch { return { ok: false, out: "" }; }
};
const isAncestor = (a: string, b: string) => git(["merge-base", "--is-ancestor", a, b]).ok;
const say = (l: string) => process.stderr.write(`kb: ${l}\n`);

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
    if (git(["update-ref", "refs/heads/main", plan.to, plan.from]).ok) say(`landed; main is now ${plan.to.slice(0, 7)}.`);
    else say("WARNING could not fast-forward main; contact an operator.");
  }
  process.exit(0);
}

const verdict = checkPush({ session, updates, main: main.ok ? main.out : null, isAncestor });
for (const l of verdict.messages) say(l);
process.exit(verdict.ok ? 0 : 1);
