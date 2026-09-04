#!/usr/bin/env node
/**
 * lore: command-line interface to the knowledge-base orchestrator.
 * Results on stdout, diagnostics on stderr. A command's own exit code passes through;
 * exit codes 100 to 104 with a "lore:" prefix on stderr mean the request never ran.
 */
import { CliError, HelpRequested } from "./errors.js";
import { session } from "./commands/session.js";
import { exec } from "./commands/exec.js";
import { token } from "./commands/token.js";
import { user } from "./commands/user.js";
import { login, me } from "./commands/login.js";
import { mcp } from "./commands/mcp.js";

const HELP = `usage: lore <command> [args]

  login <url> --token T    save server and token to the config file
  me                       who the current token belongs to
  session <subcommand>     create | list | show | close | log
  exec [ID] -- <cmd...>    run a command in a session (streams stdin when piped)
  token <subcommand>       create | list | revoke
  user <subcommand>        create | list            (admin only)
  mcp                      MCP server over stdio, relaying to the logged-in server
                           (claude mcp add lore -- lore mcp)

Environment: LORE_URL, LORE_TOKEN override the config file; LORE_SESSION is the default session id.
Exit codes: the command's own; 100 connection, 101 auth, 102 no such session, 103 timeout, 104 usage.`;

const commands: Record<string, (args: string[]) => Promise<void>> = { login, me, session, exec, token, user, mcp };

// `lore session log | head` closes our stdout early; that is not an error worth a stack trace.
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });

async function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!name || name === "--help" || name === "-h" || name === "help") { process.stdout.write(HELP + "\n"); return; }
  const cmd = commands[name];
  if (!cmd) throw new CliError(104, `unknown command '${name}'\n${HELP}`);
  await cmd(args);
}

main().catch((e: unknown) => {
  if (e instanceof HelpRequested) { process.stdout.write(e.text + "\n"); process.exit(0); }
  if (e instanceof CliError) { process.stderr.write(`lore: ${e.message}\n`); process.exit(e.code); }
  process.stderr.write(`lore: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(100);
});
