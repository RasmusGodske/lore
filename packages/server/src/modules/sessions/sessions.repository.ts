import { Injectable } from "@nestjs/common";
import { DatabaseService, now } from "../database";
import { hashSecret } from "../auth";

export type SessionState = "created" | "active" | "closed" | "expired" | "failed";

export interface SessionRow {
  id: string; state: SessionState; branch: string; container_id: string | null; workspace: string;
  base_commit: string | null; git_token_hash: string; user_id: string; token_id: string; created_ip: string | null;
  purpose: string | null; created_at: string; last_activity_at: string;
  closed_at: string | null; close_reason: string | null;
}

/** A session row joined with the names a reader wants. */
export interface SessionRecord extends SessionRow { user_name: string; token_label: string }

const SELECT = `SELECT s.*, u.name AS user_name, t.label AS token_label
  FROM sessions s JOIN users u ON u.id = s.user_id JOIN tokens t ON t.id = s.token_id`;

/** All SQL for the sessions table lives here. */
@Injectable()
export class SessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  insert(r: Pick<SessionRow, "id" | "branch" | "workspace" | "git_token_hash" | "user_id" | "token_id" | "created_ip" | "purpose">): void {
    const ts = now();
    this.db.conn.prepare(`INSERT INTO sessions
      (id, state, branch, workspace, git_token_hash, user_id, token_id, created_ip, purpose, created_at, last_activity_at)
      VALUES (?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.branch, r.workspace, r.git_token_hash, r.user_id, r.token_id, r.created_ip, r.purpose, ts, ts);
  }

  get(id: string): SessionRecord | undefined {
    return this.db.conn.prepare(`${SELECT} WHERE s.id = ?`).get(id) as unknown as SessionRecord | undefined;
  }

  byGitToken(plaintext: string): SessionRecord | undefined {
    return this.db.conn.prepare(`${SELECT} WHERE s.git_token_hash = ?`).get(hashSecret(plaintext)) as unknown as SessionRecord | undefined;
  }

  list(opts: { all?: boolean; userId?: string; limit?: number } = {}): SessionRecord[] {
    const where: string[] = []; const params: (string | number)[] = [];
    if (!opts.all) where.push("s.state IN ('created','active')");
    if (opts.userId) { where.push("s.user_id = ?"); params.push(opts.userId); }
    params.push(opts.limit ?? 500);
    const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.created_at DESC LIMIT ?`;
    return this.db.conn.prepare(sql).all(...params) as unknown as SessionRecord[];
  }

  liveRows(): SessionRow[] {
    return this.db.conn.prepare("SELECT * FROM sessions WHERE state IN ('active','created')").all() as unknown as SessionRow[];
  }

  idleSince(cutoffIso: string): SessionRow[] {
    return this.db.conn.prepare("SELECT * FROM sessions WHERE state = 'active' AND last_activity_at < ?").all(cutoffIso) as unknown as SessionRow[];
  }

  endedBefore(cutoffIso: string): SessionRow[] {
    return this.db.conn.prepare("SELECT * FROM sessions WHERE state IN ('failed','closed','expired') AND COALESCE(closed_at, last_activity_at) < ?").all(cutoffIso) as unknown as SessionRow[];
  }

  setState(id: string, state: SessionState, extra: Partial<Pick<SessionRow, "container_id" | "base_commit" | "closed_at" | "close_reason">> = {}): void {
    const cols = Object.keys(extra) as (keyof typeof extra)[];
    const sets = ["state = ?", ...cols.map((c) => `${c} = ?`)].join(", ");
    this.db.conn.prepare(`UPDATE sessions SET ${sets} WHERE id = ?`).run(state, ...cols.map((c) => extra[c] ?? null), id);
  }

  touch(id: string): void {
    this.db.conn.prepare("UPDATE sessions SET last_activity_at = ? WHERE id = ?").run(now(), id);
  }
}
