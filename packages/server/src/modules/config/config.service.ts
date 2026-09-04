import { Injectable } from "@nestjs/common";
import path from "node:path";
import { z } from "zod";

const num = (fallback: number) => z.coerce.number().default(fallback);
/** Compose passes unset settings through as empty strings; treat those as absent. */
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const EnvSchema = z.object({
  LORE_DATA_DIR: z.string().default("/srv/lore"),
  LORE_HOST_DATA_DIR: z.string().optional(),
  LORE_PORT: num(8080),
  LORE_SERVER_HOST: z.string().default("lore-server"),
  LORE_SANDBOX_IMAGE: z.string().default("ghcr.io/rasmusgodske/lore-sandbox:latest"),
  LORE_SANDBOX_RUNTIME: z.enum(["runc", "runsc"]).default("runc"),
  LORE_SANDBOX_NETWORK: z.string().default("lore-net"),
  LORE_SANDBOX_MEMORY_BYTES: num(1024 ** 3),
  LORE_SANDBOX_CPUS: num(1),
  LORE_SANDBOX_PIDS_LIMIT: num(256),
  LORE_IDLE_TIMEOUT_HOURS: num(24),
  LORE_REAPER_INTERVAL_MINUTES: num(60),
  LORE_EXEC_DEFAULT_TIMEOUT_MS: num(60_000),
  LORE_EXEC_MAX_TIMEOUT_MS: num(600_000),
  LORE_EXEC_OUTPUT_CAP_BYTES: num(1024 * 1024),
  LORE_AUDIT_HEAD_BYTES: num(64 * 1024),
  LORE_SEED_DIR: z.string().default("/app/seed"),
  LORE_HOOK_SCRIPT: z.string().default("/app/dist/modules/git/hook.js"),
  LORE_DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  /** Baked into the image at build time by the release workflow; "dev" for local builds. */
  LORE_VERSION: z.string().default("dev"),
  /**
   * Remote: when set, that git repository (e.g. on GitHub) is the source of truth. lore keeps a
   * local copy current, sessions start from the remote's main, and a landing is a push to it.
   * Unset = standalone, lore's own repository is the truth.
   */
  LORE_REMOTE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  LORE_REMOTE_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  LORE_REMOTE_USERNAME: z.string().default("lore"),
  LORE_REMOTE_REFRESH_MINUTES: num(5),
});
export type Env = z.infer<typeof EnvSchema>;

/** Typed view of the environment. Validated once at startup; unknown values fail fast. */
@Injectable()
export class ConfigService {
  readonly env: Env = EnvSchema.parse(process.env);
  get dataDir() { return this.env.LORE_DATA_DIR; }
  /** The data directory as the host Docker daemon sees it, for bind mounts. */
  get hostDataDir() { return this.env.LORE_HOST_DATA_DIR ?? this.env.LORE_DATA_DIR; }
  get dbPath() { return path.join(this.dataDir, "lore.db"); }
  get repoPath() { return path.join(this.dataDir, "knowledge.git"); }
  get sessionsDir() { return path.join(this.dataDir, "sessions"); }
  /** A read-only checkout of main, kept current so people can browse the knowledge as files. */
  get mainCheckoutPath() { return path.join(this.dataDir, "main"); }
  workspacePath(id: string) { return path.join(this.sessionsDir, id); }
  hostWorkspacePath(id: string) { return path.join(this.hostDataDir, "sessions", id); }
  get idleTimeoutMs() { return this.env.LORE_IDLE_TIMEOUT_HOURS * 3_600_000; }
  get reaperIntervalMs() { return this.env.LORE_REAPER_INTERVAL_MINUTES * 60_000; }
  get remote(): { url: string; username: string; token: string } | null {
    const url = this.env.LORE_REMOTE_URL;
    return url ? { url, username: this.env.LORE_REMOTE_USERNAME, token: this.env.LORE_REMOTE_TOKEN ?? "" } : null;
  }
  gitRemoteUrl(gitToken: string) { return `http://${this.env.LORE_SERVER_HOST}:${this.env.LORE_PORT}/git/${gitToken}/knowledge.git`; }
}
