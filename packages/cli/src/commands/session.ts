import { makeContext, resolveSessionId } from "../context.js";
import { parse } from "../args.js";
import { formatAuditEvent, printJson, printTable, wantsJson } from "../output.js";
import { usage, HelpRequested, wantsHelp } from "../errors.js";
import type { Session } from "../client.js";

const HELP = `usage: lore session <command>

  create [--purpose TEXT]                     create a session, print its id
  list [--all] [--user ID]                    list sessions (active by default)
  show [ID]                                   show one session
  close [ID]                                  close a session; unpushed work is discarded
  log [ID]                                    the session's audit log

ID defaults to $LORE_SESSION. Add --json for machine-readable output (default when piped).`;

const row = (s: Session) => [s.id, s.state, `${s.user}/${s.token_label}`, s.last_activity_at, s.purpose ?? ""];

export async function session(args: string[]) {
  if (wantsHelp(args)) throw new HelpRequested(HELP);
  const [sub, ...rest] = args;
  switch (sub) {
    case "create": {
      const { values } = parse(rest, { purpose: { type: "string" }, json: { type: "boolean" } });
      const s = await makeContext().client.createSession({ purpose: values.purpose });
      if (wantsJson(values.json) && values.json) printJson(s); else process.stdout.write(s.id + "\n");
      return;
    }
    case "list": {
      const { values } = parse(rest, { all: { type: "boolean" }, user: { type: "string" }, json: { type: "boolean" } });
      const list = await makeContext().client.listSessions({ all: values.all, user: values.user });
      if (wantsJson(values.json)) printJson(list);
      else printTable(list.map(row), ["ID", "STATE", "USER/TOKEN", "LAST ACTIVITY", "PURPOSE"]);
      return;
    }
    case "show": {
      const { values, positionals } = parse(rest, { json: { type: "boolean" } });
      const s = await makeContext().client.getSession(resolveSessionId(positionals[0]));
      if (wantsJson(values.json)) printJson(s);
      else printTable(Object.entries(s).map(([k, v]) => [k, v === null ? "" : String(v)]));
      return;
    }
    case "close": {
      const { values, positionals } = parse(rest, { json: { type: "boolean" } });
      const s = await makeContext().client.closeSession(resolveSessionId(positionals[0]));
      if (wantsJson(values.json)) printJson(s); else process.stdout.write(`${s.id} ${s.state}\n`);
      return;
    }
    case "log": {
      const { values, positionals } = parse(rest, { json: { type: "boolean" } });
      const jsonl = await makeContext().client.sessionLog(resolveSessionId(positionals[0]));
      if (wantsJson(values.json)) { process.stdout.write(jsonl); return; }
      for (const line of jsonl.split("\n").filter(Boolean)) process.stdout.write(formatAuditEvent(JSON.parse(line)) + "\n");
      return;
    }
    default:
      throw usage(HELP);
  }
}
