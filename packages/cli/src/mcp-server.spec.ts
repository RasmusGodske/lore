/** Subject: the stdio JSON-RPC server. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { handleMessage, runMcpServer, text, type ToolDefinition } from "./mcp-server.js";

const echo: ToolDefinition = {
  name: "echo", title: "Echo", description: "returns its input",
  inputSchema: { type: "object", properties: { s: { type: "string" } } },
  handler: async ({ s }) => text(String(s)),
};
const boom: ToolDefinition = { name: "boom", title: "Boom", description: "throws", inputSchema: { type: "object" }, handler: async () => { throw new Error("kaput"); } };
const opts = { tools: [echo, boom], instructions: "read me first" };

const call = async (msg: unknown) => JSON.parse((await handleMessage(JSON.stringify(msg), opts))!);

describe("handleMessage", () => {
  it("answers initialize with the tools capability and the instructions", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    assert.equal(r.id, 1);
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.equal(r.result.instructions, "read me first");
    assert.equal(r.result.serverInfo.name, "lore");
  });
  it("lists tools without their handlers", async () => {
    const r = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(r.result.tools.map((t: { name: string }) => t.name), ["echo", "boom"]);
    assert.equal("handler" in r.result.tools[0], false);
    assert.equal(r.result.tools[0].inputSchema.type, "object");
  });
  it("calls a tool with its arguments", async () => {
    const r = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { s: "hi" } } });
    assert.deepEqual(r.result.content, [{ type: "text", text: "hi" }]);
  });
  it("reports a tool that threw as a failed result, not a protocol error", async () => {
    const r = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } });
    assert.equal(r.error, undefined);
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /kaput/);
  });
  it("rejects an unknown tool and an unknown method with JSON-RPC errors", async () => {
    assert.equal((await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).error.code, -32602);
    assert.equal((await call({ jsonrpc: "2.0", id: 6, method: "resources/list" })).error.code, -32601);
  });
  it("answers ping, ignores notifications, and reports unparsable input", async () => {
    assert.deepEqual((await call({ jsonrpc: "2.0", id: 7, method: "ping" })).result, {});
    assert.equal(await handleMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}', opts), null);
    assert.equal(JSON.parse((await handleMessage("{not json", opts))!).error.code, -32700);
  });
});

describe("runMcpServer", () => {
  it("serves line-delimited messages until stdin closes", async () => {
    const input = new PassThrough(); const output = new PassThrough();
    const done = runMcpServer(input, output, opts);
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    input.end();
    await done;
    const replies = output.read().toString().trim().split("\n").map((l: string) => JSON.parse(l));
    assert.deepEqual(replies.map((r: { id: number }) => r.id).sort(), [1, 2]);
  });
});
