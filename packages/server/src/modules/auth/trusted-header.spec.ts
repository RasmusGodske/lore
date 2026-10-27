/**
 * Subject: the trusted identity header (auth/README.md, spec 04 "Identity and auth"): who a
 * request is when a login proxy in front of lore names the person.
 * Tier: isolated. A real SQLite database in a temporary directory; no HTTP, no Docker.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigService } from "../config";
import { DatabaseService } from "../database";
import { TransportError } from "../api";
import { AuthService } from "./auth.service";
import { TokensService } from "./tokens.service";
import { UsersService } from "./users.service";
import { parseTrustedProxies } from "./trusted-proxies";

const PROXY = "10.0.0.7";
const ELSEWHERE = "203.0.113.9";

function build(env: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const config = new ConfigService();
    const db = new DatabaseService(config);
    const users = new UsersService(db);
    const tokens = new TokensService(db);
    return { db, users, tokens, auth: new AuthService(tokens, users, config) };
  } finally {
    process.env = saved;
  }
}

const refused = (fn: () => unknown, message: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof TransportError && e.code === 101 && message.test((e.getResponse() as { error: { message: string } }).error.message));

describe("trusted identity header", () => {
  let dir: string;
  let s: ReturnType<typeof build>;
  let bearer: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-auth-"));
    s = build({ LORE_DATA_DIR: dir, LORE_AUTH_TRUSTED_HEADER: "X-Forwarded-Email", LORE_AUTH_TRUSTED_PROXIES: "10.0.0.0/24, fd00::/8" });
    const bot = s.users.create("bot", false);
    bearer = s.tokens.create(bot.id, "agent").token;
  });
  after(() => { s.db.onModuleDestroy(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("makes the named user the principal when a trusted proxy sends the header", () => {
    const p = s.auth.authenticate({ identity: "Alice@Example.com", peer: PROXY, ip: "198.51.100.4" });
    assert.equal(p.user.name, "alice@example.com");
    assert.equal(p.user.is_admin, 0);
    assert.equal(p.token.label, "proxy");
    assert.equal(p.token.user_id, p.user.id);
    assert.equal(p.ip, "198.51.100.4");
  });

  it("creates the user on first sight, and only once", () => {
    assert.equal(s.users.byName("carol@example.com"), undefined);
    const first = s.auth.authenticate({ identity: "carol@example.com", peer: PROXY, ip: PROXY });
    const again = s.auth.authenticate({ identity: "carol@example.com", peer: "::ffff:10.0.0.9", ip: PROXY });
    assert.equal(again.user.id, first.user.id);
    assert.equal(again.token.id, first.token.id, "one proxy credential per user, so the audit log names one token");
    assert.equal(s.users.list().filter((u) => u.name === "carol@example.com").length, 1);
    assert.equal(s.tokens.listForUser(first.user.id).length, 1);
  });

  it("refuses the header from an untrusted address, even with a valid bearer token beside it", () => {
    refused(() => s.auth.authenticate({ identity: "alice@example.com", peer: ELSEWHERE, ip: ELSEWHERE }), /only accepted from a trusted proxy/);
    refused(() => s.auth.authenticate({ identity: "alice@example.com", bearer, peer: ELSEWHERE, ip: ELSEWHERE }), /only accepted from a trusted proxy/);
    refused(() => s.auth.authenticate({ identity: "mallory@example.com", peer: "", ip: "" }), /trusted proxy/);
    assert.equal(s.users.byName("mallory@example.com"), undefined, "an untrusted header creates nobody");
  });

  it("falls back to the bearer token when a trusted proxy sends no header", () => {
    assert.equal(s.auth.authenticate({ bearer, peer: PROXY, ip: PROXY }).user.name, "bot");
    assert.equal(s.auth.authenticate({ bearer, identity: "  ", peer: PROXY, ip: PROXY }).user.name, "bot", "an empty header is no header");
    refused(() => s.auth.authenticate({ peer: PROXY, ip: PROXY }), /missing bearer token/);
  });

  it("lets a lore token beside the header decide, so an agent keeps its own attribution through the proxy", () => {
    const p = s.auth.authenticate({ identity: "alice@example.com", bearer, peer: PROXY, ip: PROXY });
    assert.equal(p.user.name, "bot");
    assert.equal(p.token.label, "agent");
  });

  it("refuses a revoked lore token beside the header instead of falling back to the header", () => {
    const bot = s.users.byName("bot")!;
    const minted = s.tokens.create(bot.id, "leaked");
    s.tokens.revoke(minted.row.id);
    refused(() => s.auth.authenticate({ identity: "alice@example.com", bearer: minted.token, peer: PROXY, ip: PROXY }), /invalid or revoked/);
    refused(() => s.auth.authenticate({ identity: "alice@example.com", bearer: `lore_${"0".repeat(48)}`, peer: PROXY, ip: PROXY }), /invalid or revoked/);
  });

  it("ignores a bearer that is not a lore token beside the header, such as the proxy's own credential", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2ln";
    assert.equal(s.auth.authenticate({ identity: "alice@example.com", bearer: jwt, peer: PROXY, ip: PROXY }).user.name, "alice@example.com");
    refused(() => s.auth.authenticate({ bearer: jwt, peer: PROXY, ip: PROXY }), /invalid or revoked/);
  });

  it("keeps bearer tokens working from anywhere", () => {
    assert.equal(s.auth.authenticate({ bearer, peer: ELSEWHERE, ip: ELSEWHERE }).user.name, "bot");
  });

  it("refuses an identity that is not a valid user name, or a header sent twice", () => {
    refused(() => s.auth.authenticate({ identity: "Not A Name", peer: PROXY, ip: PROXY }), /not a valid user name/);
    refused(() => s.auth.authenticate({ identity: ["a@example.com", "b@example.com"], peer: PROXY, ip: PROXY }), /more than once/);
  });

  it("refuses a user whose proxy credential was revoked", () => {
    const p = s.auth.authenticate({ identity: "dave@example.com", peer: PROXY, ip: PROXY });
    s.tokens.revoke(p.token.id);
    refused(() => s.auth.authenticate({ identity: "dave@example.com", peer: PROXY, ip: PROXY }), /revoked/);
    assert.equal(s.tokens.restore(p.token.id), true, "a revocation made by mistake can be lifted");
    assert.equal(s.auth.authenticate({ identity: "dave@example.com", peer: PROXY, ip: PROXY }).user.id, p.user.id);
  });

  it("the proxy credential is not a bearer token", () => {
    const p = s.auth.authenticate({ identity: "erin@example.com", peer: PROXY, ip: PROXY });
    refused(() => s.auth.authenticate({ bearer: p.token.token_hash, peer: ELSEWHERE, ip: ELSEWHERE }), /invalid or revoked/);
  });
});

describe("trusted identity header, switched off", () => {
  it("ignores the header entirely; only bearer tokens count", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-auth-"));
    const s = build({ LORE_DATA_DIR: dir });
    try {
      assert.equal(s.auth.trustedHeader, null);
      refused(() => s.auth.authenticate({ peer: PROXY, ip: PROXY }), /missing bearer token/);
    } finally { s.db.onModuleDestroy(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("trusted proxy list", () => {
  it("matches addresses and CIDRs of both families, including IPv4-mapped IPv6 peers", () => {
    const trusted = parseTrustedProxies("172.18.0.0/16 127.0.0.1,::1  fd00::/8");
    assert.equal(trusted("172.18.4.2"), true);
    assert.equal(trusted("::ffff:172.18.4.2"), true);
    assert.equal(trusted("127.0.0.1"), true);
    assert.equal(trusted("::1"), true);
    assert.equal(trusted("fd12::5"), true);
    assert.equal(trusted("172.19.0.1"), false);
    assert.equal(trusted("127.0.0.2"), false);
    assert.equal(trusted(""), false);
  });

  it("fails on an entry that is neither an address nor a CIDR", () => {
    for (const bad of ["proxy.internal", "10.0.0.0/33", "10.0.0.1/8/1", "10.0.0/8", "", " , "]) {
      assert.throws(() => parseTrustedProxies(bad), /LORE_AUTH_TRUSTED_PROXIES/, bad);
    }
  });
});

describe("trusted header settings", () => {
  it("must be set together", async () => {
    const { EnvSchema } = await import("../config/config.service");
    assert.throws(() => EnvSchema.parse({ LORE_AUTH_TRUSTED_HEADER: "X-Forwarded-Email" }), /set together/);
    assert.throws(() => EnvSchema.parse({ LORE_AUTH_TRUSTED_PROXIES: "10.0.0.1" }), /set together/);
    assert.doesNotThrow(() => EnvSchema.parse({ LORE_AUTH_TRUSTED_HEADER: "X-Forwarded-Email", LORE_AUTH_TRUSTED_PROXIES: "10.0.0.1" }));
  });
});
