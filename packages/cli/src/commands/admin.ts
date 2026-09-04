import { makeContext } from "../context.js";
import { parse } from "../args.js";
import { printJson, printTable, wantsJson } from "../output.js";
import { usage, HelpRequested, wantsHelp } from "../errors.js";
import type { MirrorStatus } from "../client.js";

/**
 * `lore admin ...`: managing the server. Everything here needs the admin flag and is nothing an
 * agent uses day to day. Bootstrap of the very first admin is `lore-admin` inside the container.
 */
const HELP = `usage: lore admin <command>          (admin only)

  status                     version, uptime, sandbox runtime, session counts, mirror state
  mirror status              whether main is mirrored to a git host, and how that is going
  mirror log                 recent mirror attempts, newest first
  mirror sync                push main to the mirror now
  user create <name> [--admin]
  user list
  user token <user> <label>  mint a user's first token; afterwards they mint their own

The mirror itself is configured on the server (LORE_MIRROR_URL, LORE_MIRROR_TOKEN); see the deploy guide.`;

function showMirror(m: MirrorStatus, json: boolean) {
  if (json) { printJson(m); return; }
  if (!m.configured) { process.stdout.write("mirror: not configured\n"); return; }
  printTable([
    ["remote", m.url ?? ""],
    ["last success", m.last_success_at ?? "never"],
    ["last attempt", m.last_attempt_at ?? "never"],
    ["last error", m.last_error ?? ""],
    ["failures in a row", String(m.consecutive_failures)],
    ["push pending", m.pending ? "yes" : "no"],
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
      ["mirror", s.mirror.configured ? `${s.mirror.url}  (${s.mirror.last_error ? "FAILING: " + s.mirror.last_error : "last success " + (s.mirror.last_success_at ?? "never")})` : "not configured"],
    ]);
    return;
  }

  if (group === "mirror") {
    const { values } = parse(rest, { json: { type: "boolean" } });
    if (sub === "status") return showMirror(await client.mirrorStatus(), wantsJson(values.json));
    if (sub === "sync") return showMirror(await client.mirrorSync(), wantsJson(values.json));
    if (sub === "log") {
      const log = await client.mirrorLog();
      if (wantsJson(values.json)) { printJson(log); return; }
      printTable(log.map((a) => [a.at, a.ok ? "ok" : "FAILED", a.reason, `${a.duration_ms}ms`, a.error ?? ""]), ["AT", "RESULT", "REASON", "TOOK", "ERROR"]);
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
