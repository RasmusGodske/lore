/**
 * Subject: the remote's token from a file (git/README.md, spec 03 "Remote"): read fresh at every
 * fetch and push, so a rotated token is used without a restart.
 * Tier: isolated. Real git against a local HTTP server that only records the credential it is
 * offered and refuses it; no Docker, no network beyond loopback.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { ConfigService, EnvSchema } from "../config/config.service";
import { GitRepoService } from "./git-repo.service";
import { RemoteService } from "./remote.service";

function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try { return fn(); } finally { process.env = saved; }
}

describe("remote token from a file", () => {
  let dir: string;
  let tokenFile: string;
  let server: http.Server;
  let url: string;
  const offered: string[] = [];

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-remote-token-"));
    execFileSync("git", ["init", "--quiet", "--bare", path.join(dir, "knowledge.git")]);
    tokenFile = path.join(dir, "token");
    server = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      if (auth) offered.push(Buffer.from(auth.replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":"));
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' }).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/knowledge.git`;
  });
  after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const configure = () => withEnv({ LORE_DATA_DIR: dir, LORE_REMOTE_URL: url, LORE_REMOTE_TOKEN_FILE: tokenFile }, () => new ConfigService());

  it("reads the file at each use, so a rotated token is picked up without a restart", async () => {
    const repo = new GitRepoService(configure());
    fs.writeFileSync(tokenFile, "first-token\n");
    await assert.rejects(repo.fetchRemoteMain());
    assert.equal(offered.at(-1), "first-token", "whitespace around the token is trimmed");
    fs.writeFileSync(tokenFile, "  second-token  \n");
    await assert.rejects(repo.fetchRemoteMain());
    assert.equal(offered.at(-1), "second-token");
    await assert.rejects(repo.pushMainToRemote("0".repeat(40)));
  });

  it("names a missing or empty file in the remote status", async () => {
    const config = configure();
    const remote = new RemoteService(config, new GitRepoService(config));
    fs.rmSync(tokenFile, { force: true });
    await remote.refresh("manual");
    assert.match(remote.getStatus().last_error ?? "", /no remote token: LORE_REMOTE_TOKEN_FILE .*token cannot be read/);
    fs.writeFileSync(tokenFile, " \n");
    await remote.refresh("manual");
    assert.match(remote.getStatus().last_error ?? "", /no remote token: LORE_REMOTE_TOKEN_FILE .*token is empty/);
    assert.equal(remote.getStatus().consecutive_failures, 2);
  });

  it("refuses LORE_REMOTE_TOKEN and LORE_REMOTE_TOKEN_FILE together", () => {
    assert.throws(() => EnvSchema.parse({ LORE_REMOTE_URL: url, LORE_REMOTE_TOKEN: "a", LORE_REMOTE_TOKEN_FILE: tokenFile }), /not both/);
    assert.equal(EnvSchema.parse({ LORE_REMOTE_TOKEN: "a", LORE_REMOTE_TOKEN_FILE: "" }).LORE_REMOTE_TOKEN, "a", "a blank setting counts as unset");
  });

  it("keeps LORE_REMOTE_TOKEN as it was, and no token at all for a remote that needs none", () => {
    assert.equal(withEnv({ LORE_REMOTE_TOKEN: "env-token" }, () => new ConfigService()).remoteToken(), "env-token");
    assert.equal(withEnv({}, () => { delete process.env.LORE_REMOTE_TOKEN; delete process.env.LORE_REMOTE_TOKEN_FILE; return new ConfigService(); }).remoteToken(), "");
  });
});
