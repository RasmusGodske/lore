import { makeContext } from "../context.js";
import { runBridge } from "../mcp-bridge.js";

/**
 * `lore mcp`: a stdio MCP server for clients that cannot reach the HTTP endpoint directly, or
 * that should not carry the token in their own configuration. Uses the saved login.
 *
 *   claude mcp add lore -- lore mcp
 */
export async function mcp(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("usage: lore mcp\n\nSpeaks MCP over stdio and relays to the logged-in server's /mcp endpoint.\nRegister it with your client, e.g.:  claude mcp add lore -- lore mcp\n");
    return;
  }
  const { client, url } = makeContext();
  await runBridge(process.stdin, process.stdout, { url, token: client.token });
}
