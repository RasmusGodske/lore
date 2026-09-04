/** Pure decisions for keeping the local repository in step with the remote. Unit-tested without git. */

/** A remote URL safe to log or return: credentials removed. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = ""; u.password = "";
    return u.toString();
  } catch { return "<invalid url>"; }
}

export type RefreshPlan =
  | { kind: "none" }                          // already equal, or nothing on either side
  | { kind: "fast-forward"; to: string }      // remote is ahead: move local main to it
  | { kind: "push-local"; sha: string }       // remote has no main yet: adopt lore's history
  | { kind: "diverged" };                     // both moved independently: an operator must reconcile

export function planRefresh(local: string | null, remote: string | null, isAncestor: (a: string, b: string) => boolean): RefreshPlan {
  if (!remote && !local) return { kind: "none" };
  if (!remote) return { kind: "push-local", sha: local! };
  if (!local) return { kind: "fast-forward", to: remote };
  if (local === remote) return { kind: "none" };
  if (isAncestor(local, remote)) return { kind: "fast-forward", to: remote };
  return { kind: "diverged" };
}

export interface RemoteAttempt {
  at: string;
  ok: boolean;
  duration_ms: number;
  /** What was done: fetched (with how many new commits), pushed, or nothing. */
  outcome: string;
  error: string | null;
  reason: "boot" | "session" | "fetch" | "sweep" | "manual" | "landing";
}

export interface RemoteStatus {
  configured: boolean;
  url: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  diverged: boolean;
}
