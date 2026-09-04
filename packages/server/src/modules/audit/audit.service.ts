import { Injectable } from "@nestjs/common";
import { DatabaseService, now } from "../database";
import { ConfigService } from "../config";

export type AuditOp = "create" | "exec" | "push" | "close" | "reap" | "fail";

export interface AuditInput {
  session_id: string;
  op: AuditOp;
  user_id?: string;
  token_id?: string;
  remote_ip?: string;
  cmd?: string;
  cwd?: string;
  exit_code?: number;
  duration_ms?: number;
  stdin?: Buffer;
  stdout?: Buffer;
  stderr?: Buffer;
  stdin_bytes?: number;
  truncated?: boolean;
  extra?: Record<string, unknown>;
}

export interface AuditRow {
  id: number; session_id: string; ts: string; op: AuditOp;
  user_id: string | null; token_id: string | null; remote_ip: string | null;
  cmd: string | null; cwd: string | null; exit_code: number | null; duration_ms: number | null;
  stdin_bytes: number | null; stdout_bytes: number | null; stderr_bytes: number | null;
  stdin_head: string | null; stdout_head: string | null; stderr_head: string | null;
  truncated: number; extra: string | null;
}

/** Append-only record of everything that happened in a session. */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService) {}

  record(e: AuditInput): void {
    const cap = this.config.env.LORE_AUDIT_HEAD_BYTES;
    const head = (b?: Buffer) => {
      if (b === undefined) return null;
      const slice = b.subarray(0, cap);
      // Binary payloads (a tar stream piped to stdin) are noted, not stored as mangled text.
      return slice.includes(0) ? `<binary, ${b.length} bytes>` : slice.toString("utf8");
    };
    const truncatedHead = [e.stdin, e.stdout, e.stderr].some((b) => b !== undefined && b.length > cap);
    this.db.conn.prepare(`INSERT INTO audit_events
      (session_id, ts, op, user_id, token_id, remote_ip, cmd, cwd, exit_code, duration_ms,
       stdin_bytes, stdout_bytes, stderr_bytes, stdin_head, stdout_head, stderr_head, truncated, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      e.session_id, now(), e.op, e.user_id ?? null, e.token_id ?? null, e.remote_ip ?? null,
      e.cmd ?? null, e.cwd ?? null, e.exit_code ?? null, e.duration_ms ?? null,
      e.stdin_bytes ?? e.stdin?.length ?? null, e.stdout?.length ?? null, e.stderr?.length ?? null,
      head(e.stdin), head(e.stdout), head(e.stderr), e.truncated || truncatedHead ? 1 : 0,
      e.extra ? JSON.stringify(e.extra) : null,
    );
  }

  forSession(sessionId: string): AuditRow[] {
    return this.db.conn.prepare("SELECT * FROM audit_events WHERE session_id = ? ORDER BY id").all(sessionId) as unknown as AuditRow[];
  }

  /** One JSON object per event, nulls omitted. This is the `lore session log` wire format. */
  static toEvent(r: AuditRow): Record<string, unknown> {
    const o: Record<string, unknown> = { ts: r.ts, session: r.session_id, op: r.op };
    if (r.user_id) o.user_id = r.user_id;
    if (r.token_id) o.token_id = r.token_id;
    if (r.remote_ip) o.ip = r.remote_ip;
    if (r.cmd !== null) o.cmd = r.cmd;
    if (r.cwd !== null) o.cwd = r.cwd;
    if (r.exit_code !== null) o.exit = r.exit_code;
    if (r.duration_ms !== null) o.ms = r.duration_ms;
    if (r.stdin_bytes !== null) o.stdin_bytes = r.stdin_bytes;
    if (r.stdout_bytes !== null) o.stdout_bytes = r.stdout_bytes;
    if (r.stderr_bytes !== null) o.stderr_bytes = r.stderr_bytes;
    if (r.stdin_head) o.stdin = r.stdin_head;
    if (r.stdout_head) o.stdout = r.stdout_head;
    if (r.stderr_head) o.stderr = r.stderr_head;
    if (r.truncated) o.truncated = true;
    if (r.extra) Object.assign(o, JSON.parse(r.extra));
    return o;
  }

  static toJsonl(rows: AuditRow[]): string {
    return rows.map((r) => JSON.stringify(AuditService.toEvent(r))).join("\n") + (rows.length ? "\n" : "");
  }
}
