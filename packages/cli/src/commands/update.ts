import { spawn } from "node:child_process";
import { parse } from "../args.js";
import { HelpRequested, wantsHelp } from "../errors.js";
import { printJson, wantsJson } from "../output.js";
import { PACKAGE, compareVersions, fetchLatest, ownVersion, writeCheckState } from "../version.js";

const HELP = `usage: lore update [--check] [--json]

Installs the latest published version of the lore CLI with npm (npm install -g ${PACKAGE}@<latest>).
With --check, only reports whether a newer version exists. If the global install belongs to
root, the command prints the sudo line to run instead of failing silently.`;

/** The outcome of an update, separated from printing so it can be tested. */
export interface UpdateOutcome { current: string; latest: string; action: "up-to-date" | "checked" | "updated" | "failed"; exit_code: number; hint?: string }

export interface UpdateDeps {
  current?: () => string;
  latest?: () => Promise<string>;
  /** Runs `npm install -g <spec>`; resolves with npm's exit code and what it wrote to stderr. */
  install?: (spec: string) => Promise<{ code: number; stderr: string }>;
}

const npmInstall = (spec: string) => new Promise<{ code: number; stderr: string }>((resolve, reject) => {
  const child = spawn("npm", ["install", "-g", spec], { stdio: ["ignore", "inherit", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); process.stderr.write(c); });
  child.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new Error("npm is not on PATH; install it or run the update by hand") : e));
  child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
});

export async function performUpdate(checkOnly: boolean, deps: UpdateDeps = {}): Promise<UpdateOutcome> {
  const current = (deps.current ?? ownVersion)();
  const latest = await (deps.latest ?? (() => fetchLatest()))();
  writeCheckState({ checked_at: new Date().toISOString(), latest });
  if (compareVersions(latest, current) <= 0) return { current, latest, action: "up-to-date", exit_code: 0 };
  if (checkOnly) return { current, latest, action: "checked", exit_code: 0 };
  const spec = `${PACKAGE}@${latest}`;
  const r = await (deps.install ?? npmInstall)(spec);
  if (r.code === 0) return { current, latest, action: "updated", exit_code: 0 };
  const denied = /EACCES|EPERM|permission denied/i.test(r.stderr);
  return { current, latest, action: "failed", exit_code: r.code, hint: denied ? `the global install is not writable by you; run: sudo npm install -g ${spec}` : `npm install failed; run by hand: npm install -g ${spec}` };
}

export async function update(args: string[]) {
  if (wantsHelp(args)) throw new HelpRequested(HELP);
  const { values } = parse(args, { check: { type: "boolean" }, json: { type: "boolean" } });
  const o = await performUpdate(values.check === true);
  if (wantsJson(values.json)) { printJson(o); process.exitCode = o.exit_code; return; }
  switch (o.action) {
    case "up-to-date": process.stdout.write(`lore ${o.current} is the latest version\n`); break;
    case "checked": process.stdout.write(`lore ${o.latest} is available (you have ${o.current}): run \`lore update\`\n`); break;
    case "updated": process.stdout.write(`updated lore ${o.current} -> ${o.latest}\n`); break;
    case "failed": process.stderr.write(`lore: ${o.hint}\n`); process.exitCode = o.exit_code; break;
  }
}
