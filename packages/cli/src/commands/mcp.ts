import { makeContext } from "../context.js";
import { runMcpServer } from "../mcp-server.js";
import { buildTools } from "../mcp-tools.js";

/**
 * `lore mcp`: the CLI's own MCP server over stdio. It offers what the server's /mcp endpoint
 * offers, implemented here against the HTTP API like every other command, plus lore_put, which
 * needs to run where the files are. Uses the saved login, so nothing secret goes into the
 * client's configuration.
 *
 *   claude mcp add lore -- lore mcp
 */
export async function mcp(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("usage: lore mcp\n\nSpeaks MCP over stdio using the saved login: the server's tools plus lore_put for copying local files into a session.\nRegister it with your client, e.g.:  claude mcp add lore -- lore mcp\n");
    return;
  }
  const { client } = makeContext();
  let instructions: string;
  try {
    instructions = await client.guide();
  } catch (e) {
    process.stderr.write(`lore mcp: could not fetch the guide (${e instanceof Error ? e.message : String(e)}); serving without instructions\n`);
    instructions = "lore: a git-backed knowledge base worked through sessions. Call lore_guide for how it works.";
  }
  await runMcpServer(process.stdin, process.stdout, { tools: buildTools({ client }), instructions });
}
