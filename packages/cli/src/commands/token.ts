import { makeContext } from "../context.js";
import { parse } from "../args.js";
import { printJson, printTable, wantsJson } from "../output.js";
import { usage, HelpRequested, wantsHelp } from "../errors.js";

const HELP = `usage: lore token <command>

  create <label>     mint a token for yourself; the plaintext is printed once
  list               your tokens
  revoke <id>        revoke one of your tokens (admins may revoke anyone's)`;

export async function token(args: string[]) {
  if (wantsHelp(args)) throw new HelpRequested(HELP);
  const [sub, ...rest] = args;
  const { values, positionals } = parse(rest, { json: { type: "boolean" } });
  const { client } = makeContext();
  switch (sub) {
    case "create": {
      if (!positionals[0]) throw usage(HELP);
      const t = await client.createToken(positionals[0]);
      if (wantsJson(values.json) && values.json) printJson(t); else process.stdout.write(t.token + "\n");
      return;
    }
    case "list": {
      const list = await client.listTokens();
      if (wantsJson(values.json)) printJson(list);
      else printTable(list.map((t) => [t.id, t.label, t.created_at, t.last_used_at ?? "never", t.revoked_at ? "REVOKED" : ""]), ["ID", "LABEL", "CREATED", "LAST USED", ""]);
      return;
    }
    case "revoke": {
      if (!positionals[0]) throw usage(HELP);
      const r = await client.revokeToken(positionals[0]);
      if (wantsJson(values.json)) printJson(r); else process.stdout.write(r.revoked ? "revoked\n" : "nothing to revoke\n");
      return;
    }
    default:
      throw usage(HELP);
  }
}
