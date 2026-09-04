import { makeContext } from "../context.js";
import { parse } from "../args.js";
import { printJson, printTable, wantsJson } from "../output.js";
import { usage, HelpRequested, wantsHelp } from "../errors.js";
import type { RemoteStatus } from "../client.js";

/**
 * `lore admin ...`: managing the server. Everything here needs the admin flag and is nothing an
 * agent uses day to day. Bootstrap of the very first admin is `lore-admin` inside the container.
 */
const HELP = `usage: lore admin <command>          (admin only)

  status                     version, uptime, sandbox runtime, session counts, remote state
  remote status              whether a remote repository is the source of truth, and how following it goes
  remote log                 recent fetches and landings, newest first
  remote sync                fetch the remote now and bring local main in step with it
  user create <name> [--admin]
  user list
  user token <user> <label>  mint a user's first token; afterwards they mint their own

The remote is configured on the server (LORE_REMOTE_URL, LORE_REMOTE_TOKEN); see the deploy guide.`;

function showRemote(m: RemoteStatus, json: boolean) {
  if (json) { printJson(m); return; }
  if (!m.configured) { process.stdout.write("remote: not configured; this server is the source of truth\n"); return; }
  printTable([
    ["remote", m.url ?? ""],
    ["last success", m.last_success_at ?? "never"],
    ["last attempt", m.last_attempt_at ?? "never"],
    ["last error", m.last_error ?? ""],
    ["failures in a row", String(m.consecutive_failures)],
    ["diverged", m.diverged ? "YES: an operator must reconcile" : "no"],
  ]);
}

export async function admin(args: string[]) {
  if (wantsHelp(args)) throw new HelpRequested(HELP);
  const [group, sub, ...rest] = args;
  const { client } = makeContext();

  if (group === "status") {
    const { values } = parse([sub, ...rest].filter((x): x is string => x !== undefined), { json: { type: "boolean" } });
    const s = await client.serverStatus();
    if (wantsJson(values.json)) { printJson(s); return; }
    printTable([
      ["version", s.version],
      ["uptime", `${Math.floor(s.uptime_s / 3600)}h ${Math.floor((s.uptime_s % 3600) / 60)}m`],
      ["sandbox runtime", s.sandbox_runtime],
      ["sessions", `${s.sessions.active} active, ${s.sessions.total} total`],
      ["remote", s.remote.configured ? `${s.remote.url}  (${s.remote.last_error ? "FAILING: " + s.remote.last_error : "last success " + (s.remote.last_success_at ?? "never")})` : "none; this server is the source of truth"],
    ]);
    return;
  }

  if (group === "remote") {
    const { values } = parse(rest, { json: { type: "boolean" } });
    if (sub === "status") return showRemote(await client.remoteStatus(), wantsJson(values.json));
    if (sub === "sync") return showRemote(await client.remoteSync(), wantsJson(values.json));
    if (sub === "log") {
      const log = await client.remoteLog();
      if (wantsJson(values.json)) { printJson(log); return; }
      printTable(log.map((a) => [a.at, a.ok ? "ok" : "FAILED", a.reason, `${a.duration_ms}ms`, a.outcome, a.error ?? ""]), ["AT", "RESULT", "REASON", "TOOK", "OUTCOME", "ERROR"]);
      return;
    }
    throw usage(HELP);
  }

  if (group === "user") {
    const { values, positionals } = parse(rest, { admin: { type: "boolean" }, json: { type: "boolean" } });
    if (sub === "create") {
      if (!positionals[0]) throw usage(HELP);
      const u = await client.createUser(positionals[0], !!values.admin);
      if (wantsJson(values.json)) printJson(u); else process.stdout.write(`${u.id}  ${u.name}${u.admin ? "  admin" : ""}\n`);
      return;
    }
    if (sub === "list") {
      const list = await client.listUsers();
      if (wantsJson(values.json)) printJson(list);
      else printTable(list.map((u) => [u.id, u.name, u.admin ? "admin" : "", u.created_at]), ["ID", "NAME", "", "CREATED"]);
      return;
    }
    if (sub === "token") {
      const [who, label] = positionals;
      if (!who || !label) throw usage(HELP);
      const t = await client.mintTokenFor(who, label);
      if (wantsJson(values.json) && values.json) printJson(t); else process.stdout.write(t.token + "\n");
      return;
    }
    throw usage(HELP);
  }
  throw usage(HELP);
}
