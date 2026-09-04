import { Injectable, Logger } from "@nestjs/common";
import type { Readable } from "node:stream";
import { SessionsRepository, SessionRecord, SessionRow } from "./sessions.repository";
import { ConfigService } from "../config";
import { DockerService } from "../docker";
import { GitRepoService } from "../git";
import { AuditService } from "../audit";
import { hashSecret, newSecret, shortId } from "../auth";
import { TransportError, badRequest, sessionNotFound } from "../api";
import type { Principal } from "../auth";
import { now } from "../database";
import type { SessionDto, ExecResultDto } from "./dto";

export interface ExecOptions { cwd?: string; timeoutMs?: number; stdin?: Readable }

export const toSessionDto = (r: SessionRecord): SessionDto => ({
  id: r.id, state: r.state, branch: r.branch, user: r.user_name, user_id: r.user_id, token_label: r.token_label,
  purpose: r.purpose, base_commit: r.base_commit,
  created_at: r.created_at, last_activity_at: r.last_activity_at, closed_at: r.closed_at, close_reason: r.close_reason,
});

/** The session lifecycle: create, exec, close, reap, reconcile. See spec 02. */
@Injectable()
export class SessionsService {
  private readonly log = new Logger(SessionsService.name);

  constructor(
    private readonly repo: SessionsRepository,
    private readonly config: ConfigService,
    private readonly docker: DockerService,
    private readonly git: GitRepoService,
    private readonly audit: AuditService,
  ) {}

  /** The session that owns a git token from a remote URL, if any. */
  byGitToken(plaintext: string): SessionRecord | undefined { return this.repo.byGitToken(plaintext); }

  touch(id: string): void { this.repo.touch(id); }

  get(id: string): SessionDto {
    const s = this.repo.get(id);
    if (!s) throw new TransportError(102, `session '${id}' not found`, 404);
    return toSessionDto(s);
  }

  list(opts: { all?: boolean; userId?: string } = {}): SessionDto[] {
    return this.repo.list(opts).map(toSessionDto);
  }

  async create(p: Principal, meta: { purpose?: string } = {}): Promise<SessionDto> {
    await this.docker.ping();
    const id = shortId(6);
    const gitToken = newSecret("loreg");
    this.repo.insert({
      id, branch: `session/${id}`, workspace: this.config.workspacePath(id), git_token_hash: hashSecret(gitToken),
      user_id: p.user.id, token_id: p.token.id, created_ip: p.ip, purpose: meta.purpose ?? null,
    });
    try {
      const { baseCommit } = await this.git.prepareWorkspace(id, gitToken, p.user.name);
      const containerId = await this.docker.startSandbox(id);
      this.repo.setState(id, "active", { base_commit: baseCommit, container_id: containerId });
      this.audit.record({ session_id: id, op: "create", ...this.actor(p), extra: { purpose: meta.purpose, base_commit: baseCommit } });
      this.log.log(`session ${id} created for ${p.user.name}/${p.token.label}`);
      return this.get(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.repo.setState(id, "failed", { closed_at: now(), close_reason: `create failed: ${msg}` });
      this.audit.record({ session_id: id, op: "fail", ...this.actor(p), extra: { error: msg } });
      this.git.deleteWorkspace(id);
      throw e instanceof TransportError ? e : new TransportError(100, msg, 502);
    }
  }

  async exec(p: Principal, id: string, command: string, opts: ExecOptions = {}): Promise<ExecResultDto> {
    const s = this.requireActive(id);
    if (typeof command !== "string" || command.length === 0) throw badRequest("command must be a non-empty string");
    const cwd = this.resolveCwd(opts.cwd);
    const env = this.config.env;
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? env.LORE_EXEC_DEFAULT_TIMEOUT_MS, 1000), env.LORE_EXEC_MAX_TIMEOUT_MS);
    const base = { session_id: id, op: "exec" as const, cmd: command, cwd: opts.cwd, ...this.actor(p) };
    try {
      const r = await this.docker.exec({ containerId: s.container_id!, command, cwd, timeoutMs, stdin: opts.stdin });
      this.repo.touch(id);
      this.audit.record({ ...base, exit_code: r.exitCode, duration_ms: r.durationMs, stdout: r.stdout, stderr: r.stderr, stdin: r.stdinHead, stdin_bytes: r.stdinBytes, truncated: r.truncated });
      return { stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8"), exit_code: r.exitCode, duration_ms: r.durationMs, stdin_bytes: r.stdinBytes, truncated: r.truncated };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.audit.record({ ...base, extra: { transport_error: msg, code: e instanceof TransportError ? e.code : undefined } });
      if (e instanceof TransportError && e.code === 100 && !(await this.docker.isRunning(s.container_id!))) {
        this.repo.setState(id, "failed", { closed_at: now(), close_reason: "sandbox container died" });
        this.audit.record({ session_id: id, op: "fail", ...this.actor(p), extra: { error: "sandbox container died" } });
      }
      throw e;
    }
  }

  async close(p: Principal, id: string): Promise<SessionDto> {
    const s = this.repo.get(id);
    if (!s || (s.state !== "active" && s.state !== "created")) throw sessionNotFound(id);
    await this.teardown(s, "closed", "closed by caller", this.actor(p));
    return this.get(id);
  }

  /** Idle sessions are torn down; unpushed work is discarded, its shape logged. */
  async reapIdle(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.idleTimeoutMs).toISOString();
    const rows = this.repo.idleSince(cutoff);
    for (const s of rows) {
      try { await this.teardown(s, "expired", `idle since ${s.last_activity_at}`); }
      catch (e) { this.log.error(`reap of ${s.id} failed: ${String(e)}`); }
    }
    // Workspaces of failed sessions are kept for inspection, then swept after the same window.
    for (const s of this.repo.endedBefore(cutoff)) this.git.deleteWorkspace(s.id);
    return rows.length;
  }

  /** On boot: a live session whose container is gone is marked failed; a stray container is removed. */
  async reconcile(): Promise<void> {
    const live = await this.docker.listSandboxes();
    for (const s of this.repo.liveRows()) {
      const cid = live.get(s.id);
      if (cid && (await this.docker.isRunning(cid))) {
        if (s.container_id !== cid) this.repo.setState(s.id, "active", { container_id: cid });
        continue;
      }
      this.audit.record({ session_id: s.id, op: "fail", extra: { error: "container missing at orchestrator boot" } });
      this.repo.setState(s.id, "failed", { closed_at: now(), close_reason: "container missing at orchestrator boot" });
      this.log.warn(`session ${s.id} marked failed: container missing at boot`);
    }
    for (const [sid, cid] of live) {
      const s = this.repo.get(sid);
      if (!s || (s.state !== "active" && s.state !== "created")) {
        await this.docker.removeSandbox(cid).catch(() => undefined);
        this.log.warn(`removed stray sandbox for session ${sid}`);
      }
    }
  }

  private async teardown(s: SessionRow, state: "closed" | "expired", reason: string, actor: Record<string, string | undefined> = {}) {
    const snap = await this.git.snapshot(s.id);
    this.audit.record({ session_id: s.id, op: state === "closed" ? "close" : "reap", ...actor, extra: { reason, git_status: snap.status, diffstat: snap.diffstat, unpushed: snap.unpushed } });
    if (s.container_id) {
      try { await this.docker.removeSandbox(s.container_id); }
      catch (e) { this.log.warn(`failed to remove sandbox of ${s.id}: ${String(e)}`); }
    }
    this.git.deleteWorkspace(s.id);
    this.repo.setState(s.id, state, { closed_at: now(), close_reason: reason });
    this.log.log(`session ${s.id} ${state}: ${reason}`);
  }

  private requireActive(id: string): SessionRow {
    const s = this.repo.get(id);
    if (!s || s.state !== "active" || !s.container_id) throw sessionNotFound(id);
    return s;
  }

  private actor(p: Principal) { return { user_id: p.user.id, token_id: p.token.id, remote_ip: p.ip }; }

  private resolveCwd(cwd: string | undefined): string {
    if (!cwd) return "/workspace";
    if (cwd.includes("\0")) throw badRequest("invalid cwd");
    const clean = cwd.replace(/^\/+/, "").replace(/^workspace\/?/, "");
    if (clean.split("/").includes("..")) throw badRequest("cwd must stay inside /workspace");
    return clean ? `/workspace/${clean}` : "/workspace";
  }
}
