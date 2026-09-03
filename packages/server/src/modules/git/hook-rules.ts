/** Pure hook logic, separated so it can be unit-tested without git. */

export const ZERO_SHA = "0".repeat(40);

export interface RefUpdate { oldSha: string; newSha: string; ref: string }

export interface PushCheckInput {
  session: string;
  updates: RefUpdate[];
  /** Current main sha, or null if the repo has no main. */
  main: string | null;
  isAncestor: (ancestor: string, descendant: string) => boolean;
}

export interface Verdict { ok: boolean; messages: string[] }

export const MERGE_HINT = "run: git fetch origin && git merge origin/main   then commit and push again.";

export function checkPush(input: PushCheckInput): Verdict {
  const { session, updates, main, isAncestor } = input;
  if (!session) return { ok: false, messages: ["no session identity on this push; refusing."] };
  const own = `refs/heads/session/${session}`;
  const messages: string[] = [];

  for (const u of updates) {
    if (!u.ref.startsWith("refs/heads/session/")) {
      return { ok: false, messages: [`'${u.ref}' is not writable. Push to ${own} instead; main is updated automatically when your push is accepted.`] };
    }
    if (u.ref !== own) return { ok: false, messages: [`session '${session}' may not push to '${u.ref}'. Your branch is ${own}.`] };
    if (u.newSha === ZERO_SHA) return { ok: false, messages: ["deleting the session branch is not allowed."] };
    if (u.oldSha !== ZERO_SHA && !isAncestor(u.oldSha, u.newSha)) {
      return { ok: false, messages: ["non-fast-forward push to your session branch rejected. Do not rewrite history;", MERGE_HINT] };
    }
    if (!main) return { ok: false, messages: ["repository has no main branch; refusing."] };
    if (!isAncestor(main, u.newSha)) {
      return { ok: false, messages: ["your branch is behind main and would not fast-forward.", "run: git fetch origin && git merge origin/main", "resolve any conflicts in the files, commit, and push again."] };
    }
    messages.push(`accepted ${u.ref}.`);
  }
  return { ok: true, messages };
}

export type LandingPlan =
  | { kind: "skip" }
  | { kind: "warn"; message: string }
  | { kind: "fast-forward"; from: string; to: string };

export function planLanding(u: RefUpdate, main: string | null, isAncestor: PushCheckInput["isAncestor"]): LandingPlan {
  if (!u.ref.startsWith("refs/heads/session/") || !main || main === u.newSha) return { kind: "skip" };
  if (!isAncestor(main, u.newSha)) {
    return { kind: "warn", message: `WARNING main moved during push; ${u.ref} accepted but not landed. Fetch, merge and push again.` };
  }
  return { kind: "fast-forward", from: main, to: u.newSha };
}
