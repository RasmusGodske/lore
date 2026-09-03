import { Injectable } from "@nestjs/common";
import path from "node:path";
import { z } from "zod";

const num = (fallback: number) => z.coerce.number().default(fallback);

export const EnvSchema = z.object({
  KB_DATA_DIR: z.string().default("/srv/kb"),
  KB_HOST_DATA_DIR: z.string().optional(),
  KB_PORT: num(8080),
  KB_ORCHESTRATOR_HOST: z.string().default("kb-orchestrator"),
  KB_SANDBOX_IMAGE: z.string().default("kb-sandbox:latest"),
  KB_SANDBOX_RUNTIME: z.enum(["runc", "runsc"]).default("runc"),
  KB_SANDBOX_NETWORK: z.string().default("kb-net"),
  KB_SANDBOX_MEMORY_BYTES: num(1024 ** 3),
  KB_SANDBOX_CPUS: num(1),
  KB_SANDBOX_PIDS_LIMIT: num(256),
  KB_IDLE_TIMEOUT_HOURS: num(24),
  KB_REAPER_INTERVAL_MINUTES: num(60),
  KB_EXEC_DEFAULT_TIMEOUT_MS: num(60_000),
  KB_EXEC_MAX_TIMEOUT_MS: num(600_000),
  KB_EXEC_OUTPUT_CAP_BYTES: num(1024 * 1024),
  KB_AUDIT_HEAD_BYTES: num(64 * 1024),
  KB_SEED_DIR: z.string().default("/app/seed"),
  KB_HOOK_SCRIPT: z.string().default("/app/dist/modules/git/hook.js"),
  KB_DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
});
export type Env = z.infer<typeof EnvSchema>;

/** Typed view of the environment. Validated once at startup; unknown values fail fast. */
@Injectable()
export class ConfigService {
  readonly env: Env = EnvSchema.parse(process.env);
  get dataDir() { return this.env.KB_DATA_DIR; }
  /** The data directory as the host Docker daemon sees it, for bind mounts. */
  get hostDataDir() { return this.env.KB_HOST_DATA_DIR ?? this.env.KB_DATA_DIR; }
  get dbPath() { return path.join(this.dataDir, "kb.db"); }
  get repoPath() { return path.join(this.dataDir, "knowledge.git"); }
  get sessionsDir() { return path.join(this.dataDir, "sessions"); }
  /** A read-only checkout of main, kept current so people can browse the knowledge as files. */
  get mainCheckoutPath() { return path.join(this.dataDir, "main"); }
  workspacePath(id: string) { return path.join(this.sessionsDir, id); }
  hostWorkspacePath(id: string) { return path.join(this.hostDataDir, "sessions", id); }
  get idleTimeoutMs() { return this.env.KB_IDLE_TIMEOUT_HOURS * 3_600_000; }
  get reaperIntervalMs() { return this.env.KB_REAPER_INTERVAL_MINUTES * 60_000; }
  gitRemoteUrl(gitToken: string) { return `http://${this.env.KB_ORCHESTRATOR_HOST}:${this.env.KB_PORT}/git/${gitToken}/knowledge.git`; }
}
