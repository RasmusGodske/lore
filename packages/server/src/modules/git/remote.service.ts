import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "../config";
import { GitRepoService } from "./git-repo.service";
import { redactUrl, type RemoteAttempt, type RemoteStatus } from "./remote-plan";

/**
 * When a remote is configured it is the source of truth. This service keeps lore's copy of main
 * current (at boot, before a session starts, when a sandbox fetches, on a periodic sweep, and on
 * request) and records how that is going. Landing itself happens in the hook, which fetches the
 * remote, checks the rules against it, and pushes before accepting.
 */
@Injectable()
export class RemoteService implements OnModuleInit {
  private readonly log = new Logger(RemoteService.name);
  private status: RemoteStatus = { configured: false, url: null, last_attempt_at: null, last_success_at: null, last_error: null, consecutive_failures: 0, diverged: false };
  private readonly attempts: RemoteAttempt[] = [];
  private static readonly LOG_SIZE = 50;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly config: ConfigService, private readonly repo: GitRepoService) {
    const r = config.remote;
    if (r) this.status = { ...this.status, configured: true, url: redactUrl(r.url) };
  }

  async onModuleInit() {
    if (!this.status.configured) return;
    await this.refresh("boot");
    const sweep = setInterval(() => void this.refresh("sweep"), this.config.env.LORE_REMOTE_REFRESH_MINUTES * 60_000);
    sweep.unref();
  }

  get configured(): boolean { return this.status.configured; }
  getStatus(): RemoteStatus { return { ...this.status }; }
  getLog(): RemoteAttempt[] { return [...this.attempts].reverse(); }

  /** Record a landing the hook pushed to the remote, so the log shows the whole story. */
  recordLanding(ok: boolean, error: string | null, durationMs: number) {
    this.push({ at: new Date().toISOString(), ok, duration_ms: durationMs, outcome: ok ? "pushed a landing" : "landing push refused", error, reason: "landing" });
    if (ok) { this.status.last_success_at = new Date().toISOString(); }
  }

  /**
   * Fetch the remote and fast-forward local main to it (or push lore's main to an empty remote).
   * Concurrent callers share one in-flight refresh. Never throws: failures land in the status.
   */
  refresh(reason: RemoteAttempt["reason"]): Promise<void> {
    if (!this.status.configured) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async doRefresh(reason: RemoteAttempt["reason"]): Promise<void> {
    const started = Date.now();
    this.status.last_attempt_at = new Date().toISOString();
    try {
      const plan = await this.repo.refreshFromRemote();
      const outcome = plan.kind === "fast-forward" ? `fetched ${plan.newCommits ?? "?"} new commit(s) from the remote`
        : plan.kind === "push-local" ? "remote was empty; pushed lore's main to it"
        : plan.kind === "diverged" ? "DIVERGED: local main and remote main have both moved; an operator must reconcile"
        : "up to date";
      const ok = plan.kind !== "diverged";
      this.status.diverged = plan.kind === "diverged";
      this.push({ at: this.status.last_attempt_at, ok, duration_ms: Date.now() - started, outcome, error: ok ? null : outcome, reason });
      if (ok) { this.status.last_success_at = new Date().toISOString(); this.status.last_error = null; this.status.consecutive_failures = 0; }
      else { this.status.last_error = outcome; this.status.consecutive_failures += 1; this.log.error(outcome); }
      if (plan.kind !== "none") this.log.log(`remote refresh (${reason}): ${outcome}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.status.last_error = error;
      this.status.consecutive_failures += 1;
      this.push({ at: this.status.last_attempt_at!, ok: false, duration_ms: Date.now() - started, outcome: "fetch failed", error, reason });
      this.log.warn(`remote refresh (${reason}) failed: ${error}`);
    }
  }

  private push(a: RemoteAttempt) {
    this.attempts.push(a);
    if (this.attempts.length > RemoteService.LOG_SIZE) this.attempts.shift();
  }
}
