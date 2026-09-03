/** Subject: the client's translation of HTTP outcomes into the CLI's exit-code vocabulary. Tier: isolated (fetch is faked). */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { KbClient } from "./client.js";
import { CliError } from "./errors.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fake(status: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  globalThis.fetch = (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })) as typeof fetch;
}
const client = () => new KbClient("http://kb", "kb_x");

describe("transport error mapping", () => {
  it("maps 401 to code 101 with the server's message", async () => {
    fake(401, { error: { code: 101, message: "invalid or revoked token" } });
    await assert.rejects(client().me(), (e: CliError) => e.code === 101 && /revoked/.test(e.message));
  });
  it("maps 404 to 102, 504 to 103, 400 to 104", async () => {
    fake(404, { error: { code: 102, message: "no" } }); await assert.rejects(client().getSession("x"), (e: CliError) => e.code === 102);
    fake(504, { error: { code: 103, message: "slow" } }); await assert.rejects(client().exec("x", { command: "sleep" }), (e: CliError) => e.code === 103);
    fake(400, { error: { code: 104, message: "bad" } }); await assert.rejects(client().createToken(""), (e: CliError) => e.code === 104);
  });
  it("maps an unreachable server to code 100 naming the URL", async () => {
    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await assert.rejects(client().me(), (e: CliError) => e.code === 100 && /http:\/\/kb/.test(e.message));
  });
  it("returns a command's non-zero exit as a result, never as an error", async () => {
    fake(200, { stdout: "", stderr: "cat: nope", exit_code: 1, duration_ms: 3, stdin_bytes: 0, truncated: false });
    const r = await client().exec("k7", { command: "cat nope" });
    assert.equal(r.exit_code, 1);
  });
  it("returns the audit log as raw JSONL text, not parsed", async () => {
    fake(200, '{"op":"create"}\n{"op":"exec"}\n', { "content-type": "application/x-ndjson" });
    assert.equal(await client().sessionLog("k7"), '{"op":"create"}\n{"op":"exec"}\n');
  });
});
