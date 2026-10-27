import { Injectable } from "@nestjs/common";
import { DatabaseService, now } from "../database";
import { hashSecret, newSecret, shortId } from "./ids";

export interface TokenRow {
  id: string; user_id: string; label: string; token_hash: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
}

@Injectable()
export class TokensService {
  constructor(private readonly db: DatabaseService) {}

  /** Mints a token. The plaintext is returned exactly once and never stored. */
  create(userId: string, label: string): { token: string; row: TokenRow } {
    const token = newSecret("lore"); // keep in step with looksLikeToken
    const row: TokenRow = { id: shortId(8), user_id: userId, label, token_hash: hashSecret(token), created_at: now(), last_used_at: null, revoked_at: null };
    this.db.conn.prepare("INSERT INTO tokens (id, user_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.user_id, row.label, row.token_hash, row.created_at);
    return { token, row };
  }

  listForUser(userId: string): TokenRow[] {
    return this.db.conn.prepare("SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at").all(userId) as unknown as TokenRow[];
  }
  byId(id: string): TokenRow | undefined {
    return this.db.conn.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as unknown as TokenRow | undefined;
  }
  findLive(plaintext: string): TokenRow | undefined {
    return this.db.conn.prepare("SELECT * FROM tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .get(hashSecret(plaintext)) as unknown as TokenRow | undefined;
  }
  /**
   * The credential a user acts through when a trusted proxy names them, created on first use.
   * It has no plaintext: its hash column holds a marker no secret can hash to. Revoking it
   * refuses that user through the proxy.
   */
  proxyCredential(userId: string): TokenRow {
    const marker = `proxy:${userId}`;
    const existing = this.db.conn.prepare("SELECT * FROM tokens WHERE token_hash = ?").get(marker) as unknown as TokenRow | undefined;
    if (existing) return existing;
    const row: TokenRow = { id: shortId(8), user_id: userId, label: TokensService.PROXY_LABEL, token_hash: marker, created_at: now(), last_used_at: null, revoked_at: null };
    this.db.conn.prepare("INSERT INTO tokens (id, user_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.user_id, row.label, row.token_hash, row.created_at);
    return row;
  }
  static readonly PROXY_LABEL = "proxy";

  /** Whether a bearer value has the shape of a token this server mints, valid or not. */
  static looksLikeToken(bearer: string | undefined): boolean { return !!bearer && /^lore_[0-9a-f]{48}$/.test(bearer); }

  /** Lifts a revocation; for a proxy credential revoked by mistake. */
  restore(id: string): boolean {
    return this.db.conn.prepare("UPDATE tokens SET revoked_at = NULL WHERE id = ? AND revoked_at IS NOT NULL").run(id).changes > 0;
  }

  touch(id: string) { this.db.conn.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(now(), id); }
  revoke(id: string): boolean {
    return this.db.conn.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now(), id).changes > 0;
  }
}
