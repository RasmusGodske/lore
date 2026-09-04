import { parse } from "../args.js";
import { LoreClient } from "../client.js";
import { saveConfig } from "../config.js";
import { makeContext } from "../context.js";
import { printJson, wantsJson } from "../output.js";
import { usage } from "../errors.js";

/** lore login <url> --token <token>: verifies the token, then saves both. */
export async function login(args: string[]) {
  const { values, positionals } = parse(args, { token: { type: "string" } });
  const url = positionals[0]?.replace(/\/$/, "");
  if (!url || !values.token) throw usage("usage: lore login <url> --token <token>");
  const me = await new LoreClient(url, values.token).me();
  const path = saveConfig({ url, token: values.token });
  process.stderr.write(`logged in as ${me.user}${me.admin ? " (admin)" : ""} with token '${me.token}'; saved to ${path}\n`);
}

export async function me(args: string[]) {
  const { values } = parse(args, { json: { type: "boolean" } });
  const m = await makeContext().client.me();
  if (wantsJson(values.json)) printJson(m); else process.stdout.write(`${m.user}${m.admin ? " (admin)" : ""} via token '${m.token}'\n`);
}
