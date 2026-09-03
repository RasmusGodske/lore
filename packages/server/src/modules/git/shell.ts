import { execFile } from "node:child_process";

export interface RunResult { stdout: string; stderr: string; code: number }

/** Run a local command. Never throws on non-zero exit. */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

/** git with safe.directory disabled: the orchestrator runs as root over workspaces owned by the sandbox uid. */
export const git = (args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  run("git", ["-c", "safe.directory=*", ...args], opts);

export async function gitOrThrow(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const r = await git(args, opts);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
  return r.stdout;
}
