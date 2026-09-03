import { Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import { PassThrough, Readable } from "node:stream";
import { ConfigService } from "../config";
import { connectionError, timeoutError } from "../api";

export const SANDBOX_UID = 1000;

export interface ExecRequest {
  containerId: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  /** Streamed to the command's stdin, then closed. Absent means stdin is closed immediately. */
  stdin?: Readable;
}

export interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  durationMs: number;
  stdinBytes: number;
  stdinHead: Buffer;
  truncated: boolean;
}

/** Everything that talks to the host Docker daemon. */
@Injectable()
export class DockerService {
  private readonly log = new Logger(DockerService.name);
  private readonly docker: Docker;

  constructor(private readonly config: ConfigService) {
    this.docker = new Docker({ socketPath: config.env.KB_DOCKER_SOCKET });
  }

  private wrap(e: unknown): never {
    throw connectionError(`docker: ${e instanceof Error ? e.message : String(e)}`);
  }

  async ping(): Promise<void> {
    try { await this.docker.ping(); } catch (e) { this.wrap(e); }
  }

  async startSandbox(sessionId: string): Promise<string> {
    const env = this.config.env;
    try {
      const container = await this.docker.createContainer({
        Image: env.KB_SANDBOX_IMAGE,
        name: `kb-sess-${sessionId}`,
        Cmd: ["sleep", "infinity"],
        User: `${SANDBOX_UID}:${SANDBOX_UID}`,
        WorkingDir: "/workspace",
        Env: [`KB_SESSION_ID=${sessionId}`, "HOME=/tmp", "GIT_TERMINAL_PROMPT=0"],
        Labels: { "kb.session": sessionId, "kb.role": "sandbox" },
        HostConfig: {
          Runtime: env.KB_SANDBOX_RUNTIME,
          NetworkMode: env.KB_SANDBOX_NETWORK,
          ReadonlyRootfs: true,
          Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
          Binds: [`${this.config.hostWorkspacePath(sessionId)}:/workspace`],
          Memory: env.KB_SANDBOX_MEMORY_BYTES,
          NanoCpus: Math.round(env.KB_SANDBOX_CPUS * 1e9),
          PidsLimit: env.KB_SANDBOX_PIDS_LIMIT,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
        },
      });
      await container.start();
      return container.id;
    } catch (e) { this.wrap(e); }
  }

  async removeSandbox(containerId: string): Promise<void> {
    try { await this.docker.getContainer(containerId).remove({ force: true, v: true }); }
    catch (e: any) { if (e?.statusCode !== 404) this.wrap(e); }
  }

  async isRunning(containerId: string): Promise<boolean> {
    try { return (await this.docker.getContainer(containerId).inspect()).State.Running === true; }
    catch (e: any) { if (e?.statusCode === 404) return false; this.wrap(e); }
  }

  /** session id -> container id for every sandbox this orchestrator created. */
  async listSandboxes(): Promise<Map<string, string>> {
    try {
      const list = await this.docker.listContainers({ all: true, filters: { label: ["kb.role=sandbox"] } });
      return new Map(list.map((c) => [c.Labels["kb.session"], c.Id]));
    } catch (e) { this.wrap(e); }
  }

  /**
   * Run a shell command in the sandbox. The timeout is enforced inside the container by
   * coreutils `timeout` so the process group really dies; a backstop timer covers a hung stream.
   */
  async exec(r: ExecRequest): Promise<ExecResult> {
    const cap = this.config.env.KB_EXEC_OUTPUT_CAP_BYTES;
    const headCap = this.config.env.KB_AUDIT_HEAD_BYTES;
    const seconds = Math.max(1, Math.ceil(r.timeoutMs / 1000));
    const started = Date.now();
    const container = this.docker.getContainer(r.containerId);

    let exec: Docker.Exec;
    try {
      exec = await container.exec({
        Cmd: ["timeout", "-k", "5", String(seconds), "sh", "-c", r.command],
        WorkingDir: r.cwd,
        AttachStdout: true, AttachStderr: true, AttachStdin: true, Tty: false,
      });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 409) throw connectionError(`sandbox container is gone (${e.statusCode})`);
      this.wrap(e);
    }

    const outChunks: Buffer[] = []; const errChunks: Buffer[] = []; const inHead: Buffer[] = [];
    let outLen = 0, errLen = 0, inLen = 0, inHeadLen = 0, truncated = false;
    const out = new PassThrough(); const err = new PassThrough();
    out.on("data", (b: Buffer) => { if (outLen < cap) { outChunks.push(b); outLen += b.length; } else truncated = true; });
    err.on("data", (b: Buffer) => { if (errLen < cap) { errChunks.push(b); errLen += b.length; } else truncated = true; });

    let stream: NodeJS.ReadWriteStream;
    try { stream = (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream; }
    catch (e) { this.wrap(e); }

    await new Promise<void>((resolve, reject) => {
      const backstop = setTimeout(() => reject(timeoutError(`command still running after ${r.timeoutMs}ms plus grace`)), r.timeoutMs + 15_000);
      this.docker.modem.demuxStream(stream, out, err);
      stream.on("end", () => { clearTimeout(backstop); resolve(); });
      stream.on("error", (e: Error) => { clearTimeout(backstop); reject(connectionError(`exec stream: ${e.message}`)); });
      if (r.stdin) {
        r.stdin.on("data", (b: Buffer) => { inLen += b.length; if (inHeadLen < headCap) { inHead.push(b); inHeadLen += b.length; } });
        r.stdin.on("error", () => stream.end());
        r.stdin.pipe(stream as any); // pipe ends the write side on EOF, which Docker delivers as stdin EOF
      } else {
        (stream as any).end();
      }
    });

    let info: Docker.ExecInspectInfo;
    try { info = await exec.inspect(); } catch (e) { this.wrap(e); }
    const durationMs = Date.now() - started;
    const exitCode = info.ExitCode ?? -1;
    // GNU timeout exits 124 (TERM) or 137 (KILL after the -k grace) when the command ran out of time.
    if ((exitCode === 124 || exitCode === 137) && durationMs >= r.timeoutMs * 0.9) {
      throw timeoutError(`command timed out after ${r.timeoutMs}ms`);
    }
    this.log.debug(`exec ${r.containerId.slice(0, 12)} exit=${exitCode} ${durationMs}ms`);
    return {
      stdout: Buffer.concat(outChunks).subarray(0, cap),
      stderr: Buffer.concat(errChunks).subarray(0, cap),
      exitCode, durationMs, truncated,
      stdinBytes: inLen,
      stdinHead: Buffer.concat(inHead).subarray(0, headCap),
    };
  }
}
