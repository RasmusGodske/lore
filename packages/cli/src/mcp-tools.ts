/**
 * The tools `lore mcp` offers: the same five the server's /mcp endpoint declares, implemented
 * here against the HTTP API the way the CLI commands are, plus lore_put, which only a client
 * running on the machine that holds the files can offer. The two MCP servers are separate
 * implementations; this one is the superset.
 */
import { spawn } from "node:child_process";
import { stat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { LoreClient, ExecResult } from "./client.js";
import { CliError } from "./errors.js";
import { text, type ToolDefinition, type ToolResult } from "./mcp-server.js";

const SHELL_DESCRIPTION = `Run a shell command inside a sandboxed checkout of the knowledge base.

/workspace is a git clone on your own branch (session/<id>); nothing is visible to anyone until you push. Normal Unix tools are available (rg, cat, ls, sed, awk, jq, python3, git); there is no network. Start by reading /workspace/index.md, and any conventions file the repository keeps (for example AGENTS.md) before writing.

Land changes with: git add -A && git commit -m "..." && git push origin HEAD
An accepted push lands on main immediately. If it is rejected because main moved: git fetch origin && git merge origin/main, resolve conflict markers, commit, push again. Never rebase or force-push.

Returns stdout, stderr and the exit code as the command produced them; a non-zero exit code means the command failed, not the tool. Output is capped at 1 MB. For files that already exist on this machine, use lore_put instead of writing them through this tool: it streams them into the session without their content passing through you. The server's instructions (or GET /guide) explain the whole mechanism.`;

const CREATE_DESCRIPTION = `Create a knowledge-base session: a fresh sandbox with its own checkout and branch. Call this once per task, then pass the returned session_id to lore_shell. Close it with lore_session_close when the task is done. Idle sessions are reaped after 24 hours and their unpushed work is discarded.`;

const PUT_DESCRIPTION = `Copy a file or a directory from this machine into a session's workspace. The content is streamed by the lore client directly to the server, so it never passes through you: use this for anything you already have as files (a document you drafted locally, a directory of pages), however large. A directory is copied with its contents; a file keeps its name. dest is a directory under /workspace, created if missing. Afterwards, land the files with lore_shell as usual (git add, commit, push).`;

const errorResult = (e: unknown): ToolResult => ({
  ...text(e instanceof CliError ? `lore: ${e.message} (transport error ${e.code})` : `lore: ${e instanceof Error ? e.message : String(e)}`),
  isError: true,
});

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new CliError(104, `${name} is required`);
  return v;
};

/** A running local `tar -c`: its stream and its exit code. Injectable so tests need no tar. */
export interface TarProducer { stream: Readable; done: Promise<number> }
export type SpawnTar = (args: string[]) => TarProducer;

const spawnTar: SpawnTar = (args) => {
  const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
  const done = new Promise<number>((resolve, reject) => {
    child.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new CliError(104, "tar is not installed on this machine; lore_put needs it") : e));
    child.on("close", (code) => (code === 0 ? resolve(0) : reject(new Error(`local tar failed (${code}): ${stderr.trim()}`))));
  });
  return { stream: child.stdout, done };
};

/** Files and bytes under a path, so the result can say what was sent. */
export async function measure(source: string): Promise<{ files: number; bytes: number; directory: boolean }> {
  const s = await stat(source);
  if (!s.isDirectory()) return { files: 1, bytes: s.size, directory: false };
  let files = 0; let bytes = 0;
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files++;
    bytes += (await stat(path.join(entry.parentPath ?? (entry as { path?: string }).path ?? source, entry.name))).size;
  }
  return { files, bytes, directory: true };
}

/** A destination is a directory under /workspace: relative, and never climbing out. */
export function workspaceDest(dest: unknown): string {
  const d = typeof dest === "string" && dest.trim() !== "" ? dest.trim() : ".";
  if (path.posix.isAbsolute(d) || d.split("/").includes("..")) throw new CliError(104, "dest must be a relative path under /workspace");
  const n = path.posix.normalize(d).replace(/\/+$/, "");
  return n === "" ? "." : n;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const formatExec = (r: ExecResult): ToolResult => {
  let out = r.stdout;
  const nl = () => (out && !out.endsWith("\n") ? "\n" : "");
  if (r.stderr) out += `${nl()}--- stderr ---\n${r.stderr}`;
  if (r.exit_code !== 0) out += `${nl()}--- exit code ${r.exit_code} ---`;
  if (r.truncated) out += "\n--- output truncated ---";
  return { content: [{ type: "text", text: out || "(no output)" }], structuredContent: { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code, duration_ms: r.duration_ms }, isError: false };
};

export interface ToolDeps { client: LoreClient; spawnTar?: SpawnTar; measure?: typeof measure }

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  const { client } = deps;
  const tar = deps.spawnTar ?? spawnTar;
  const size = deps.measure ?? measure;

  return [
    {
      name: "lore_guide",
      title: "How lore works, or the OKF specification",
      description: "Returns the guide to how lore works (the same text as these instructions), or with topic \"okf\" the full Open Knowledge Format specification that documents follow. Read the specification when you need more than the guide's short format section, for example before designing a repository's layout or conventions.",
      inputSchema: { type: "object", properties: { topic: { type: "string", enum: ["lore", "okf"], description: "\"lore\" (default) or \"okf\"" } } },
      handler: async ({ topic }) => { try { return text(topic === "okf" ? await client.okfSpec() : await client.guide()); } catch (e) { return errorResult(e); } },
    },
    {
      name: "lore_session_create",
      title: "Create knowledge-base session",
      description: CREATE_DESCRIPTION,
      inputSchema: { type: "object", properties: { purpose: { type: "string", maxLength: 500, description: "What this session is for, in one line." } } },
      handler: async ({ purpose }) => {
        try {
          const s = await client.createSession({ purpose: typeof purpose === "string" ? purpose : undefined });
          return { ...text(`session_id: ${s.id}\nbranch: ${s.branch}\nbase_commit: ${s.base_commit}\nworkspace: /workspace`), structuredContent: { session_id: s.id, branch: s.branch, base_commit: s.base_commit } };
        } catch (e) { return errorResult(e); }
      },
    },
    {
      name: "lore_session_list",
      title: "List knowledge-base sessions",
      description: "List sessions. By default only active ones, for every user.",
      inputSchema: { type: "object", properties: { all: { type: "boolean", description: "Include closed, expired and failed sessions." } } },
      handler: async ({ all }) => {
        try {
          const list = await client.listSessions({ all: all === true });
          return { ...text(list.length ? list.map((s) => `${s.id}  ${s.state.padEnd(8)} ${s.user}/${s.token_label}  ${s.purpose ?? ""}`).join("\n") : "no sessions"), structuredContent: { sessions: list } };
        } catch (e) { return errorResult(e); }
      },
    },
    {
      name: "lore_session_close",
      title: "Close knowledge-base session",
      description: "Tear down a session's sandbox and workspace. Push first: anything not pushed is discarded.",
      inputSchema: { type: "object", properties: { session_id: { type: "string", description: "The session to close." } }, required: ["session_id"] },
      handler: async ({ session_id }) => {
        try { const s = await client.closeSession(str(session_id, "session_id")); return text(`session ${s.id} closed`); }
        catch (e) { return errorResult(e); }
      },
    },
    {
      name: "lore_shell",
      title: "Run a command in the knowledge base",
      description: SHELL_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session from lore_session_create." },
          command: { type: "string", minLength: 1, description: "Shell command, run with sh -c in /workspace." },
          cwd: { type: "string", description: "Working directory relative to /workspace." },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 600000, description: "Default 60000." },
        },
        required: ["session_id", "command"],
      },
      handler: async ({ session_id, command, cwd, timeout_ms }) => {
        try {
          const r = await client.exec(str(session_id, "session_id"), { command: str(command, "command"), cwd: typeof cwd === "string" ? cwd : undefined, timeout_ms: typeof timeout_ms === "number" ? timeout_ms : undefined });
          return formatExec(r);
        } catch (e) { return errorResult(e); }
      },
    },
    {
      name: "lore_put",
      title: "Copy local files into the knowledge base",
      description: PUT_DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session from lore_session_create." },
          source: { type: "string", description: "Absolute path on this machine: a file, or a directory copied with its contents." },
          dest: { type: "string", description: "Directory under /workspace to copy into, created if missing. Default: the workspace root." },
        },
        required: ["session_id", "source"],
      },
      handler: async ({ session_id, source, dest }) => {
        try {
          const id = str(session_id, "session_id");
          const src = path.resolve(str(source, "source"));
          const target = workspaceDest(dest);
          const what = await size(src);
          const tarArgs = what.directory ? ["-c", "-C", src, "."] : ["-c", "-C", path.dirname(src), path.basename(src)];
          const producer = tar(tarArgs);
          const command = `mkdir -p -- ${shellQuote(target)} && tar -x -C ${shellQuote(target)}`;
          const [r] = await Promise.all([client.execStdin(id, command, producer.stream, { timeout_ms: 600_000 }), producer.done]);
          if (r.exit_code !== 0) return { ...formatExec(r), isError: true };
          const where = target === "." ? "/workspace" : `/workspace/${target}`;
          return { ...text(`copied ${what.files} file${what.files === 1 ? "" : "s"} (${what.bytes} bytes) into ${where}`), structuredContent: { files: what.files, bytes: what.bytes, dest: where } };
        } catch (e) { return errorResult(e); }
      },
    },
  ];
}
