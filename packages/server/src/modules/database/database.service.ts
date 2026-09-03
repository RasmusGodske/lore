import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ConfigService } from "../config";

export const TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  branch TEXT NOT NULL,
  container_id TEXT,
  workspace TEXT NOT NULL,
  base_commit TEXT,
  git_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_id TEXT NOT NULL REFERENCES tokens(id),
  created_ip TEXT,
  purpose TEXT,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  ts TEXT NOT NULL,
  op TEXT NOT NULL,
  user_id TEXT,
  token_id TEXT,
  remote_ip TEXT,
  cmd TEXT,
  cwd TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  stdin_bytes INTEGER,
  stdout_bytes INTEGER,
  stderr_bytes INTEGER,
  stdin_head TEXT,
  stdout_head TEXT,
  stderr_head TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  extra TEXT
);
`;

export const INDEXES = `
CREATE INDEX IF NOT EXISTS sessions_state ON sessions(state);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_session ON audit_events(session_id, id);
CREATE INDEX IF NOT EXISTS audit_user ON audit_events(user_id, ts);
`;

/** One SQLite file holds users, tokens, sessions and audit events. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db?: DatabaseSync;
  constructor(private readonly config: ConfigService) {}

  onModuleInit() { this.open(); }
  onModuleDestroy() { this.db?.close(); this.db = undefined; }

  get conn(): DatabaseSync {
    if (!this.db) this.open();
    return this.db!;
  }

  private open() {
    fs.mkdirSync(path.dirname(this.config.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.config.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(TABLES);
    this.migrate();
    this.db.exec(INDEXES);
  }

  /** Additive migrations: columns that later versions added to existing tables. */
  private migrate() {
    const db = this.db!;
    const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [table, defs] of Object.entries(MIGRATION_COLUMNS)) {
      const have = columns(table);
      for (const [name, ddl] of Object.entries(defs)) {
        if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      }
    }
  }
}

/** Column -> DDL, per table. Add here when a column is added to SCHEMA after first release. Runs before indexes. */
export const MIGRATION_COLUMNS: Record<string, Record<string, string>> = {
  sessions: { created_ip: "TEXT" },
  audit_events: {
    user_id: "TEXT", token_id: "TEXT", remote_ip: "TEXT",
    stdin_bytes: "INTEGER", stdin_head: "TEXT", truncated: "INTEGER NOT NULL DEFAULT 0",
  },
};

export const now = () => new Date().toISOString();
