/**
 * Subject: identity and permissions as promised by auth/README.md (spec 04, "Identity and auth").
 * Tier: stack (declared below). Uses the running orchestrator's HTTP API; no sandbox is created.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { stackTier, skipReason, freshUser, Api } from "../../../test/support/stack";

const stack = stackTier();

describe("auth", { skip: stack ? false : skipReason }, () => {
  let user: Api; let admin: Api;
  before(async () => {
    user = (await freshUser(stack!)).api;
    admin = new Api(stack!.url, stack!.adminToken);
  });

  it("rejects a missing or unknown bearer token with 401 and code 101", async () => {
    const none = await fetch(`${stack!.url}/me`);
    assert.equal(none.status, 401);
    assert.equal((await none.json()).error.code, 101);
    const bad = await new Api(stack!.url, "lore_nope").call("GET", "/me");
    assert.equal(bad.status, 401);
  });

  it("tells a token who it is", async () => {
    const me = await user.call("GET", "/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.admin, false);
    assert.equal(me.json.token, "test");
  });

  it("lets a user mint and revoke their own tokens, and a revoked token stops working at once", async () => {
    const minted = await user.call("POST", "/tokens", { label: "agent-x" });
    assert.equal(minted.status, 201);
    assert.match(minted.json.token, /^lore_[0-9a-f]{48}$/);
    const asAgent = new Api(stack!.url, minted.json.token);
    assert.equal((await asAgent.call("GET", "/me")).json.token, "agent-x");
    const revoked = await user.call("DELETE", `/tokens/${minted.json.id}`);
    assert.equal(revoked.json.revoked, true);
    assert.equal((await asAgent.call("GET", "/me")).status, 401);
    const listed = await user.call("GET", "/tokens");
    assert.ok(listed.json.every((t: any) => !("token" in t) && !("token_hash" in t)), "plaintext and hash never leave the server");
  });

  it("refuses non-admins the user routes with 403 and code 101", async () => {
    const r = await user.call("POST", "/users", { name: "sneaky" });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 101);
    assert.equal((await user.call("GET", "/users")).status, 403);
  });

  it("a user cannot revoke someone else's token, an admin can", async () => {
    const victim = await freshUser(stack!);
    const t = await victim.api.call("POST", "/tokens", { label: "keep" });
    assert.equal((await user.call("DELETE", `/tokens/${t.json.id}`)).status, 403);
    assert.equal((await admin.call("DELETE", `/tokens/${t.json.id}`)).json.revoked, true);
  });

  it("validates bodies with a 400 and code 104 that names the field", async () => {
    const r = await admin.call("POST", "/users", { name: "Not Valid Name" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 104);
    assert.match(r.json.error.message, /name/);
  });
});
