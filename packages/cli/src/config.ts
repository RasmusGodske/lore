import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CliConfig { url: string; token: string }

export const configPath = () =>
  process.env.LORE_CONFIG ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "lore", "config.json");

/** Environment wins over the config file, so scripts and agents never need the file. */
export function loadConfig(): Partial<CliConfig> {
  let file: Partial<CliConfig> = {};
  try { file = JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { /* no file yet */ }
  return {
    url: process.env.LORE_URL ?? file.url,
    token: process.env.LORE_TOKEN ?? file.token,
  };
}

export function saveConfig(c: CliConfig): string {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  return p;
}
