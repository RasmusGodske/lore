import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "../config";
import { git } from "./shell";
import { redactUrl, retryDelayMs, type MirrorAttempt, type MirrorStatus } from "./mirror-plan";

/**
 * Pushes `main` to a configured remote after every landing, on boot, and on a periodic sweep,
 * so the knowledge base has a continuously current copy on a git host that also serves as a
 * read-only browser. One-way: nothing is ever pulled from the mirror.
 *
 * Credentials never touch the command line or the URL: the token is handed to git through a
 * credential helper reading environment variables of the child process only.
 */
@Injectable()
export class MirrorService implements OnModuleInit {
  private readonly log = new Logger(MirrorService.name);
  private status: MirrorStatus = { configured: false, url: null, last_attempt_at: null, last_success_at: null, last_error: null, consecutive_failures: 0, pending: false };
  private running = false;
  private queued: MirrorAttempt["reason"] | null = null;
  private timer?: NodeJS.Timeout;
  private nextReason: MirrorAttempt["reason"] = "boot";
  private readonly attempts: MirrorAttempt[] = [];
  private static readonly LOG_SIZE = 50;

  constructor(private readonly config: ConfigService) {
    const url = config.env.LORE_MIRROR_URL;
    if (url) this.status = { ...this.status, configured: true, url: redactUrl(url) };
  }

  onModuleInit() {
    if (!this.status.configured) return;
    this.schedule(0, "boot");
    const sweep = setInterval(() => this.schedule(0, "sweep"), this.config.env.LORE_MIRROR_INTERVAL_MINUTES * 60_000);
    sweep.unref();
  }

  getStatus(): MirrorStatus { return { ...this.status }; }

  /** The most recent attempts, newest first. */
  getLog(): MirrorAttempt[] { return [...this.attempts].reverse(); }

  /** Request a push soon. Coalesces bursts: one push runs at a time, one more can be queued. */
  schedule(delayMs = 0, reason: MirrorAttempt["reason"] = "landing"): void {
    if (!this.status.configured) return;
    this.status.pending = true;
    this.nextReason = reason;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(this.nextReason); }, delayMs);
    this.timer.unref();
  }

  /** Push now and report the outcome. Used by the admin endpoint. */
  async syncNow(): Promise<MirrorStatus> {
    if (!this.status.configured) return this.getStatus();
    await this.run("manual");
    return this.getStatus();
  }

  private async run(reason: MirrorAttempt["reason"]): Promise<void> {
    if (this.running) { this.queued = reason; return; }
    this.running = true;
    const started = Date.now();
    try {
      const url = this.config.env.LORE_MIRROR_URL!;
      this.status.last_attempt_at = new Date().toISOString();
      const env: NodeJS.ProcessEnv = {
        LORE_MIRROR_USERNAME: this.config.env.LORE_MIRROR_USERNAME,
        LORE_MIRROR_TOKEN: this.config.env.LORE_MIRROR_TOKEN ?? "",
        GIT_TERMINAL_PROMPT: "0",
      };
      const helper = '!f() { echo "username=$LORE_MIRROR_USERNAME"; echo "password=$LORE_MIRROR_TOKEN"; }; f';
      const r = await git(["--git-dir", this.config.repoPath, "-c", `credential.helper=${helper}`, "push", "--quiet", url, "refs/heads/main:refs/heads/main"], { env });
      const ok = r.code === 0;
      const error = ok ? null : r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 500);
      this.attempts.push({ at: this.status.last_attempt_at!, ok, duration_ms: Date.now() - started, error, reason });
      if (this.attempts.length > MirrorService.LOG_SIZE) this.attempts.shift();
      if (ok) {
        this.status.last_success_at = new Date().toISOString();
        this.status.last_error = null;
        this.status.consecutive_failures = 0;
        this.status.pending = false;
        this.log.log(`mirrored main to ${this.status.url} (${reason})`);
      } else {
        this.status.consecutive_failures += 1;
        this.status.last_error = error;
        const delay = retryDelayMs(this.status.consecutive_failures);
        this.log.warn(`mirror push failed (${this.status.consecutive_failures}x): ${error}; retry in ${Math.round(delay / 1000)}s`);
        this.schedule(delay, "retry");
      }
    } finally {
      this.running = false;
      if (this.queued) { const q = this.queued; this.queued = null; this.schedule(0, q); }
    }
  }
}
