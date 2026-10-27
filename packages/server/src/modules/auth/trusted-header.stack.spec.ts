/**
 * Subject: the trusted identity header end to end (auth/README.md, spec 04 "Identity and auth"):
 * a person named by a trusted proxy uses the HTTP API and MCP, and the audit log names them.
 * Tier: stack, and only against a stack started with the mode on and this machine trusted:
 *   LORE_AUTH_TRUSTED_HEADER=X-Forwarded-Email LORE_AUTH_TRUSTED_PROXIES=<this machine as the server sees it> docker compose up -d
 *   LORE_TEST_TRUSTED_HEADER=X-Forwarded-Email npm run test:stack -w packages/server
 * The refusals (untrusted address, malformed list) are covered in the isolated tier.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { stackTier, skipReason, Api } from "../../../test/support/stack";

const stack = stackTier();
const header = process.env.LORE_TEST_TRUSTED_HEADER;

describe("trusted identity header (stack)", { skip: !stack ? skipReason : !header ? "set LORE_TEST_TRUSTED_HEADER against a stack started with the trusted header on" : false }, () => {
  const email = `t-${randomBytes(3).toString("hex")}@example.com`;
  let person: Api; let admin: Api;
  before(() => {
    person = new Api(stack!.url, "");
    admin = new Api(stack!.url, stack!.adminToken);
  });
  const as = (method: string, path: string, body?: unknown) => person.call(method, path, body, { [header!]: email });

  it("creates the person on first sight and makes them the principal", async () => {
    assert.ok(!(await admin.call("GET", "/admin/users")).json.some((u: any) => u.name === email));
    const me = await as("GET", "/me");
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.user, email);
    assert.equal(me.json.admin, false);
    assert.equal(me.json.token, "proxy");
    assert.equal((await admin.call("GET", "/admin/users")).json.filter((u: any) => u.name === email).length, 1);
  });

  it("without the header, a request still needs a bearer token", async () => {
    assert.equal((await person.call("GET", "/me")).status, 401);
    assert.equal((await admin.call("GET", "/me")).status, 200);
  });

  it("attributes the session and its commands to that person in the audit log", async () => {
    const created = await as("POST", "/sessions", { purpose: "trusted header test" });
    assert.equal(created.status, 201, created.text);
    const id = created.json.id;
    try {
      assert.equal(created.json.user, email);
      assert.equal(created.json.token_label, "proxy");
      assert.equal((await as("POST", `/sessions/${id}/exec`, { command: "true" })).json.exit_code, 0);
      const me = (await as("GET", "/me")).json;
      const log = await admin.call("GET", `/sessions/${id}/log?format=json`);
      const exec = log.json.find((e: any) => e.op === "exec");
      assert.ok(exec, log.text);
      assert.equal(exec.user_id, me.user_id);
    } finally {
      await as("DELETE", `/sessions/${id}`);
    }
  });

  it("honours the header on the MCP endpoint", async () => {
    const r = await person.call("POST", "/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lore_session_list", arguments: {} } },
      { [header!]: email, accept: "application/json, text/event-stream" });
    assert.equal(r.status, 200, r.text);
    assert.doesNotMatch(r.text, /"isError":true/);
  });
});
