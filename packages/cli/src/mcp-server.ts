/**
 * The MCP side of `lore mcp`: a JSON-RPC 2.0 server over stdio that offers a set of tools.
 * It knows nothing about lore; the tools are handed in. Kept dependency-free like the rest of
 * the CLI, so it implements only what an MCP client needs from a tools-only server:
 * initialize, ping, tools/list and tools/call. Notifications get no reply.
 */
import type { Readable, Writable } from "node:stream";
import readline from "node:readline";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** A JSON Schema object describing the arguments. */
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ServerOptions {
  tools: ToolDefinition[];
  /** Shown to the client at initialize; what the agent reads first. */
  instructions: string;
  serverInfo?: { name: string; version: string };
  onError?: (message: string) => void;
}

const PROTOCOL_VERSION = "2025-06-18";

type Request = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: number | string | null, code: number, message: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: number | string | null, result: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, result });

export const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });

/** Answers one JSON-RPC message; null when it is a notification and needs no reply. */
export async function handleMessage(raw: string, opts: ServerOptions): Promise<string | null> {
  let req: Request;
  try { req = JSON.parse(raw); } catch { return rpcError(null, -32700, "parse error"); }
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  const method = req.method ?? "";

  if (isNotification) return null;

  switch (method) {
    case "initialize": {
      const info = opts.serverInfo ?? { name: "lore", version: "0.1.0" };
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: info, instructions: opts.instructions });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: opts.tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) });
    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const tool = opts.tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      try {
        return rpcResult(id, await tool.handler(args));
      } catch (e) {
        // A tool that threw is a failed call, not a broken protocol: report it as a result.
        return rpcResult(id, { ...text(`lore: ${e instanceof Error ? e.message : String(e)}`), isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

/** Serves until stdin closes. Messages are handled concurrently; replies go out as they finish. */
export async function runMcpServer(input: Readable, output: Writable, opts: ServerOptions): Promise<void> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending: Promise<void>[] = [];
  const report = opts.onError ?? ((m) => process.stderr.write(`lore mcp: ${m}\n`));
  for await (const line of rl) {
    const message = line.trim();
    if (!message) continue;
    const job = handleMessage(message, opts)
      .then((reply) => { if (reply !== null) output.write(reply + "\n"); })
      .catch((e: unknown) => report(e instanceof Error ? e.message : String(e)));
    pending.push(job);
  }
  await Promise.all(pending);
}
