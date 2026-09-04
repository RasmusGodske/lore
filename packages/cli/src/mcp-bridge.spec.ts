/** Subject: the stdio-to-HTTP MCP relay. Tier: isolated (fetch is faked). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { parseSse, relay, runBridge } from "./mcp-bridge.js";

const fakeFetch = (status: number, body: string, type: string) =>
  (async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch;

describe("SSE parsing", () => {
  it("returns one payload per event, joining multi-line data", () => {
    const body = 'event: message\ndata: {"a":1}\n\nevent: message\ndata: {"b":\ndata: 2}\n\n';
    assert.deepEqual(parseSse(body), ['{"a":1}', '{"b":\n2}']);
  });
});

describe("relay", () => {
  it("passes a JSON reply through", async () => {
    const out = await relay('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { url: "http://s", token: "t", fetchImpl: fakeFetch(200, '{"jsonrpc":"2.0","id":1,"result":{}}', "application/json") });
    assert.deepEqual(out, ['{"jsonrpc":"2.0","id":1,"result":{}}']);
  });
  it("unwraps an SSE reply", async () => {
    const out = await relay('{"jsonrpc":"2.0","id":2,"method":"x"}', { url: "http://s", token: "t", fetchImpl: fakeFetch(200, 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":1}\n\n', "text/event-stream") });
    assert.deepEqual(out, ['{"jsonrpc":"2.0","id":2,"result":1}']);
  });
  it("returns nothing for an accepted notification", async () => {
    assert.deepEqual(await relay('{"jsonrpc":"2.0","method":"notifications/initialized"}', { url: "http://s", token: "t", fetchImpl: fakeFetch(202, "", "text/plain") }), []);
  });
  it("sends the bearer token and the accept header the server requires", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_u: string, init?: RequestInit) => { seen = init; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    await relay("{}", { url: "http://s", token: "secret", fetchImpl: spy });
    const h = seen!.headers as Record<string, string>;
    assert.equal(h.authorization, "Bearer secret");
    assert.match(h.accept, /text\/event-stream/);
  });
});

describe("bridge", () => {
  it("answers a failed request with a JSON-RPC error instead of hanging", async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const errors: string[] = [];
    const done = runBridge(input, output, { url: "http://s", token: "t", fetchImpl: fakeFetch(401, '{"error":{"code":101,"message":"invalid or revoked token"}}', "application/json"), onError: (m) => errors.push(m) });
    input.write('{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n'); input.end();
    await done;
    const reply = JSON.parse(output.read().toString());
    assert.equal(reply.id, 7);
    assert.match(reply.error.message, /invalid or revoked token/);
    assert.equal(errors.length, 1);
  });
});
