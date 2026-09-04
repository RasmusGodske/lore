import { makeContext } from "../context.js";
import { parse } from "../args.js";
import { printJson, printTable, wantsJson } from "../output.js";
import { usage } from "../errors.js";

const HELP = `usage: lore user <command>        (admin only)

  create <name> [--admin]    create a user
  list                       all users
  token <user> <label>       mint a token for a user (their first one; afterwards they mint their own)`;

export async function user(args: string[]) {
  const [sub, ...rest] = args;
  const { values, positionals } = parse(rest, { admin: { type: "boolean" }, json: { type: "boolean" } });
  const { client } = makeContext();
  switch (sub) {
    case "create": {
      if (!positionals[0]) throw usage(HELP);
      const u = await client.createUser(positionals[0], !!values.admin);
      if (wantsJson(values.json)) printJson(u); else process.stdout.write(`${u.id}  ${u.name}${u.admin ? "  admin" : ""}\n`);
      return;
    }
    case "list": {
      const list = await client.listUsers();
      if (wantsJson(values.json)) printJson(list);
      else printTable(list.map((u) => [u.id, u.name, u.admin ? "admin" : "", u.created_at]), ["ID", "NAME", "", "CREATED"]);
      return;
    }
    case "token": {
      const [who, label] = positionals;
      if (!who || !label) throw usage(HELP);
      const t = await client.mintTokenFor(who, label);
      if (wantsJson(values.json) && values.json) printJson(t); else process.stdout.write(t.token + "\n");
      return;
    }
    default:
      throw usage(HELP);
  }
}
