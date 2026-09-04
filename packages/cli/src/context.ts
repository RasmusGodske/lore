import { LoreClient } from "./client.js";
import { loadConfig } from "./config.js";
import { CliError, usage } from "./errors.js";

export interface Context { client: LoreClient; url: string }

export function makeContext(): Context {
  const c = loadConfig();
  if (!c.url) throw usage("no server configured: run `lore login <url> --token <token>` or set LORE_URL");
  if (!c.token) throw new CliError(101, "no token configured: run `lore login <url> --token <token>` or set LORE_TOKEN");
  return { client: new LoreClient(c.url.replace(/\/$/, ""), c.token), url: c.url };
}

/** Session id from the argument, else LORE_SESSION. */
export function resolveSessionId(explicit: string | undefined): string {
  const id = explicit ?? process.env.LORE_SESSION;
  if (!id) throw usage("session id required: pass it as an argument or set LORE_SESSION");
  return id;
}
