import { KbClient } from "./client.js";
import { loadConfig } from "./config.js";
import { CliError, usage } from "./errors.js";

export interface Context { client: KbClient; url: string }

export function makeContext(): Context {
  const c = loadConfig();
  if (!c.url) throw usage("no server configured: run `kb login <url> --token <token>` or set KB_URL");
  if (!c.token) throw new CliError(101, "no token configured: run `kb login <url> --token <token>` or set KB_TOKEN");
  return { client: new KbClient(c.url.replace(/\/$/, ""), c.token), url: c.url };
}

/** Session id from the argument, else KB_SESSION. */
export function resolveSessionId(explicit: string | undefined): string {
  const id = explicit ?? process.env.KB_SESSION;
  if (!id) throw usage("session id required: pass it as an argument or set KB_SESSION");
  return id;
}
