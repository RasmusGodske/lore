/**
 * The stdio side of `lore mcp`: relays MCP JSON-RPC messages between a client on stdin/stdout
 * and the server's streamable HTTP endpoint. The server is stateless, so each message is one
 * POST; the reply comes back as JSON or as a server-sent-events stream carrying JSON messages.
 * No MCP library is needed on this side, which keeps the CLI dependency-free.
 */
import type { Readable, Writable } from "node:stream";
import readline from "node:readline";

export interface BridgeOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  onError?: (message: string) => void;
}

/** Extracts the JSON payloads carried by an SSE body, one per `data:` line of each event. */
export function parseSse(body: string): string[] {
  const out: string[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());
    if (data.length) out.push(data.join("\n"));
  }
  return out;
}

/** Sends one client message and returns the server's messages (none for a notification). */
export async function relay(message: string, opts: BridgeOptions): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.url}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: message,
  });
  const text = await res.text();
  if (res.status === 202 || (res.ok && text.trim() === "")) return [];
  if (!res.ok) {
    let detail = text;
    try { detail = JSON.parse(text).error?.message ?? text; } catch { /* keep raw */ }
    throw new Error(`server answered ${res.status}: ${detail}`);
  }
  const type = res.headers.get("content-type") ?? "";
  return type.includes("text/event-stream") ? parseSse(text) : [text.trim()];
}

/** Runs the bridge until stdin closes. Returns when the client goes away. */
export async function runBridge(input: Readable, output: Writable, opts: BridgeOptions): Promise<void> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending: Promise<void>[] = [];
  const report = opts.onError ?? ((m) => process.stderr.write(`lore mcp: ${m}\n`));
  for await (const line of rl) {
    const message = line.trim();
    if (!message) continue;
    const job = relay(message, opts)
      .then((replies) => { for (const r of replies) output.write(r + "\n"); })
      .catch((e: unknown) => {
        report(e instanceof Error ? e.message : String(e));
        // Tell the client the request failed instead of leaving it waiting forever.
        try {
          const req = JSON.parse(message);
          if (req && req.id !== undefined) {
            output.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: `lore mcp: ${e instanceof Error ? e.message : String(e)}` } }) + "\n");
          }
        } catch { /* not a request we can answer */ }
      });
    pending.push(job);
  }
  await Promise.allSettled(pending);
}
