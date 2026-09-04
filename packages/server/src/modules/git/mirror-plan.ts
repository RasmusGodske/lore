/** Pure helpers for the mirror: what to show and how long to wait. Unit-tested without git. */

/** A remote URL safe to log or return: credentials removed. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = ""; u.password = "";
    return u.toString();
  } catch { return "<invalid url>"; }
}

/** Retry delay after `failures` consecutive failures: 1, 2, 4, 8 minutes, capped. */
export function retryDelayMs(failures: number, capMs = 15 * 60_000): number {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), capMs);
}

export interface MirrorStatus {
  configured: boolean;
  url: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  pending: boolean;
}

export interface MirrorAttempt {
  at: string;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  /** What triggered it: a landing, boot, the periodic sweep, a retry, or an admin. */
  reason: "landing" | "boot" | "sweep" | "retry" | "manual";
}
