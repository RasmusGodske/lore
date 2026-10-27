import { Injectable } from "@nestjs/common";
import fs from "node:fs";
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
  /** The path of a file holding the remote's token, read at every fetch and push so a rotated token is picked up. */
  LORE_REMOTE_TOKEN_FILE: z.preprocess(blankToUndefined, z.string().optional()),
  LORE_REMOTE_USERNAME: z.string().default("lore"),
  LORE_REMOTE_REFRESH_MINUTES: num(5),
  /**
   * Trusted identity header: a login proxy in front of lore authenticates the person and names
   * them in this header. Honoured only on requests whose peer address is in the proxy list.
   */
  LORE_AUTH_TRUSTED_HEADER: z.preprocess(blankToUndefined, z.string().regex(/^[A-Za-z0-9-]+$/, "must be an HTTP header name").optional()),
  /** Addresses or CIDRs, separated by commas or spaces, allowed to set the trusted header. */
  LORE_AUTH_TRUSTED_PROXIES: z.preprocess(blankToUndefined, z.string().optional()),
}).superRefine((env, ctx) => {
  if (env.LORE_REMOTE_TOKEN && env.LORE_REMOTE_TOKEN_FILE) {
    ctx.addIssue({ code: "custom", path: ["LORE_REMOTE_TOKEN_FILE"], message: "set LORE_REMOTE_TOKEN or LORE_REMOTE_TOKEN_FILE, not both" });
  }
  if (!env.LORE_AUTH_TRUSTED_HEADER !== !env.LORE_AUTH_TRUSTED_PROXIES) {
    ctx.addIssue({ code: "custom", path: ["LORE_AUTH_TRUSTED_PROXIES"], message: "LORE_AUTH_TRUSTED_HEADER and LORE_AUTH_TRUSTED_PROXIES are set together or not at all" });
  }
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
  get remote(): { url: string; username: string } | null {
    const url = this.env.LORE_REMOTE_URL;
    return url ? { url, username: this.env.LORE_REMOTE_USERNAME } : null;
  }
  /**
   * The remote's token, read now: from LORE_REMOTE_TOKEN_FILE when that is set (fresh at every
   * call, so a rotated file is picked up), else LORE_REMOTE_TOKEN, else empty (a remote that
   * needs no credential). A token file that is missing or empty throws, naming the file.
   */
  remoteToken(): string {
    const file = this.env.LORE_REMOTE_TOKEN_FILE;
    if (!file) return this.env.LORE_REMOTE_TOKEN ?? "";
    let token: string;
    try { token = fs.readFileSync(file, "utf8").trim(); }
    catch { throw new Error(`no remote token: LORE_REMOTE_TOKEN_FILE ${file} cannot be read`); }
    if (!token) throw new Error(`no remote token: LORE_REMOTE_TOKEN_FILE ${file} is empty`);
    return token;
  }
  gitRemoteUrl(gitToken: string) { return `http://${this.env.LORE_SERVER_HOST}:${this.env.LORE_PORT}/git/${gitToken}/knowledge.git`; }
}
