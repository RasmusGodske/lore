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
import { login, me } from "./commands/login.js";
import { mcp } from "./commands/mcp.js";
import { guide } from "./commands/guide.js";
import { admin } from "./commands/admin.js";
import { update } from "./commands/update.js";
import { ownVersion, updateNudge } from "./version.js";

const HELP = `usage: lore <command> [args]

  login <url> --token T    save server and token to the config file
  me                       who the current token belongs to
  guide [okf]              how lore works; "guide okf" prints the OKF specification
  session <subcommand>     create | list | show | close | log
  exec [ID] -- <cmd...>    run a command in a session (streams stdin when piped)
  token <subcommand>       create | list | revoke
  admin <subcommand>       status | remote | user   (admin only; managing the server)
  mcp                      MCP server over stdio: the server's tools plus lore_put for
                           copying local files in (claude mcp add lore -- lore mcp)
  update [--check]         install the latest published version (npm install -g)
  --version                print the version

Environment: LORE_URL, LORE_TOKEN override the config file; LORE_SESSION is the default session id.
Exit codes: the command's own; 100 connection, 101 auth, 102 no such session, 103 timeout, 104 usage.
Once a day an interactive command may add one line on stderr when a newer version exists; LORE_NO_UPDATE_CHECK=1 turns that off.`;

const commands: Record<string, (args: string[]) => Promise<void>> = { login, me, guide, session, exec, token, admin, mcp, update };

// `lore session log | head` closes our stdout early; that is not an error worth a stack trace.
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });

async function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!name || name === "--help" || name === "-h" || name === "help") { process.stdout.write(HELP + "\n"); return; }
  if (name === "--version" || name === "-v" || name === "version") { process.stdout.write(ownVersion() + "\n"); return; }
  const cmd = commands[name];
  if (!cmd) throw new CliError(104, `unknown command '${name}'\n${HELP}`);
  await cmd(args);
  await nudgeIfInteractive(name, args);
}

/** The daily version check runs only where a person will see it: never in mcp, never when piped. */
async function nudgeIfInteractive(name: string, args: string[]) {
  if (name === "mcp" || name === "update" || process.env.LORE_NO_UPDATE_CHECK === "1") return;
  if (!process.stdout.isTTY || !process.stderr.isTTY || args.includes("--json")) return;
  const line = await updateNudge(ownVersion());
  if (line) process.stderr.write(line + "\n");
}

main().catch((e: unknown) => {
  if (e instanceof HelpRequested) { process.stdout.write(e.text + "\n"); process.exit(0); }
  if (e instanceof CliError) { process.stderr.write(`lore: ${e.message}\n`); process.exit(e.code); }
  process.stderr.write(`lore: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(100);
});
