/**
 * The CLI's own version, the latest published one, and the once-a-day check that tells an
 * interactive user when they differ. The version comes from package.json, which the release
 * workflow stamps at publish time and which ships in the tarball. The registry is asked over
 * plain HTTPS, so no npm is needed to find out; npm is needed only to install.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { configPath } from "./config.js";

export const PACKAGE = "@rasmusgodske/lore";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function ownVersion(): string {
  try { return String(createRequire(import.meta.url)("../package.json").version); } catch { return "0.0.0"; }
}

/** Numeric dot-separated compare; a prerelease suffix is ignored. Positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface RegistryOptions { fetchImpl?: typeof fetch; registry?: string; timeoutMs?: number }

export const registryUrl = (explicit?: string) =>
  (explicit ?? process.env.LORE_NPM_REGISTRY ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/$/, "");

/** The latest published version, from the registry's "latest" dist-tag. Throws when unreachable. */
export async function fetchLatest(opts: RegistryOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${registryUrl(opts.registry)}/${encodeURIComponent(PACKAGE)}/latest`;
  const res = await doFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 3000) });
  if (!res.ok) throw new Error(`registry answered ${res.status} for ${url}`);
  const json = (await res.json()) as { version?: unknown };
  if (typeof json.version !== "string") throw new Error(`registry returned no version for ${PACKAGE}`);
  return json.version;
}

/** What the daily check remembers, beside the config file. */
export interface CheckState { checked_at: string; latest: string }

export const checkStatePath = () => path.join(path.dirname(configPath()), "update-check.json");

export function readCheckState(p = checkStatePath()): CheckState | null {
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<CheckState>;
    return typeof s.checked_at === "string" && typeof s.latest === "string" ? (s as CheckState) : null;
  } catch { return null; }
}

export function writeCheckState(state: CheckState, p = checkStatePath()): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    fs.writeFileSync(p, JSON.stringify(state) + "\n");
  } catch { /* a nudge is never worth an error */ }
}

export const isStale = (state: CheckState | null, now = Date.now(), interval = CHECK_INTERVAL_MS): boolean =>
  !state || !(Date.parse(state.checked_at) > now - interval);

/** The one line printed when a newer version exists; null when there is nothing to say. */
export function nudgeLine(current: string, latest: string | null): string | null {
  if (!latest || compareVersions(latest, current) <= 0) return null;
  return `lore ${latest} is available (you have ${current}): run \`lore update\``;
}

export interface NudgeDeps { now?: number; read?: () => CheckState | null; write?: (s: CheckState) => void; latest?: () => Promise<string> }

/**
 * At most once a day, finds out whether a newer version exists and returns the line to show.
 * Never throws and never blocks for longer than the registry timeout; offline means silence.
 */
export async function updateNudge(current: string, deps: NudgeDeps = {}): Promise<string | null> {
  const now = deps.now ?? Date.now();
  const read = deps.read ?? readCheckState;
  const write = deps.write ?? writeCheckState;
  let state = read();
  if (isStale(state, now)) {
    try {
      const latest = await (deps.latest ?? (() => fetchLatest({ timeoutMs: 2000 })))();
      state = { checked_at: new Date(now).toISOString(), latest };
      write(state);
    } catch { return null; }
  }
  return nudgeLine(current, state!.latest);
}
