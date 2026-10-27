import { Injectable } from "@nestjs/common";
import { TokensService, TokenRow } from "./tokens.service";
import { UsersService, UserRow } from "./users.service";
import { parseTrustedProxies } from "./trusted-proxies";
import { authError } from "../api";
import { ConfigService } from "../config";

export interface Principal { user: UserRow; token: TokenRow; ip: string }

/** What a request offers as proof of identity. */
export interface Credentials {
  bearer?: string;
  /** The trusted header's value(s), if the request carries that header at all. */
  identity?: string | string[];
  /** The address of the peer that opened the connection, not anything a header claims. */
  peer: string;
  /** The client address recorded in the audit log. */
  ip: string;
}

@Injectable()
export class AuthService {
  /** Lowercase name of the trusted identity header, or null when that mode is off. */
  readonly trustedHeader: string | null;
  private readonly isTrustedProxy: (addr: string) => boolean;

  constructor(private readonly tokens: TokensService, private readonly users: UsersService, config: ConfigService) {
    const { LORE_AUTH_TRUSTED_HEADER: header, LORE_AUTH_TRUSTED_PROXIES: proxies } = config.env;
    this.trustedHeader = header ? header.toLowerCase() : null;
    this.isTrustedProxy = header && proxies ? parseTrustedProxies(proxies) : () => false;
  }

  /**
   * From anywhere but a trusted proxy, the trusted header's presence is refused outright. From a
   * trusted proxy, a lore token beside it still decides (so an agent keeps its own token's
   * attribution through the proxy, and a revoked one stays refused); any other bearer value,
   * such as the proxy's own credential passed through, is ignored and the header decides.
   * Without the header, the bearer token decides.
   */
  authenticate(c: Credentials): Principal {
    if (this.trustedHeader && c.identity !== undefined) {
      if (!this.isTrustedProxy(c.peer)) throw authError(`the ${this.trustedHeader} header is only accepted from a trusted proxy, and this request came from ${c.peer || "an unknown address"}`);
      if (typeof c.identity !== "string") throw authError(`the ${this.trustedHeader} header was sent more than once`);
      if (c.identity.trim() && !TokensService.looksLikeToken(c.bearer)) return this.fromIdentity(c.identity, c.ip);
    }
    return this.fromBearer(c.bearer, c.ip);
  }

  private fromBearer(bearer: string | undefined, ip: string): Principal {
    if (!bearer) throw authError("missing bearer token");
    const token = this.tokens.findLive(bearer);
    if (!token) throw authError("invalid or revoked token");
    const user = this.users.byId(token.user_id);
    if (!user) throw authError("token has no user");
    this.tokens.touch(token.id);
    return { user, token, ip };
  }

  /** The user the proxy names, created on first sight, acting through their proxy credential. */
  private fromIdentity(identity: string, ip: string): Principal {
    const name = identity.trim().toLowerCase();
    if (!UsersService.validName(name)) throw authError(`the ${this.trustedHeader} header names '${name}', which is not a valid user name`);
    const user = this.users.byName(name) ?? this.users.create(name, false);
    const token = this.tokens.proxyCredential(user.id);
    if (token.revoked_at) throw authError(`proxy sign-in for '${name}' was revoked`);
    this.tokens.touch(token.id);
    return { user, token, ip };
  }
}
