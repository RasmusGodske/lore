import { Injectable } from "@nestjs/common";
import { DatabaseService, now } from "../database";
import { shortId } from "./ids";
import { badRequest } from "../api";

export interface UserRow { id: string; name: string; is_admin: number; created_at: string }

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  create(name: string, isAdmin: boolean): UserRow {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
      throw badRequest("user name must be lowercase letters, digits, '.', '_' or '-'");
    }
    if (this.byName(name)) throw badRequest(`user '${name}' already exists`);
    const row: UserRow = { id: shortId(8), name, is_admin: isAdmin ? 1 : 0, created_at: now() };
    this.db.conn.prepare("INSERT INTO users (id, name, is_admin, created_at) VALUES (?, ?, ?, ?)")
      .run(row.id, row.name, row.is_admin, row.created_at);
    return row;
  }

  list(): UserRow[] {
    return this.db.conn.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[];
  }
  byId(id: string): UserRow | undefined {
    return this.db.conn.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
  }
  byName(name: string): UserRow | undefined {
    return this.db.conn.prepare("SELECT * FROM users WHERE name = ?").get(name) as unknown as UserRow | undefined;
  }
}
