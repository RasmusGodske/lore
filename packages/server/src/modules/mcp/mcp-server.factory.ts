import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionsService } from "../sessions";
import { TransportError } from "../api";
import type { Principal } from "../auth";

const SHELL_DESCRIPTION = `Run a shell command inside a sandboxed checkout of the shared knowledge base.

/workspace is a real git clone on your own branch (session/<id>); nothing you do there is visible to anyone until you push. You have the normal Unix tools: rg, cat, ls, sed, awk, jq, python3, git. Start by reading /workspace/AGENTS.md and /workspace/index.md.

To land changes:
  git add -A && git commit -m "..." && git push origin HEAD
If the push is rejected because main moved, run:
  git fetch origin && git merge origin/main
resolve any conflict markers in the files, commit, and push again. Never rebase or force-push.

Returns stdout, stderr and the exit code exactly as the command produced them. A non-zero exit code means the command failed, not the tool. Output is capped at 1 MB. For bulk file transfer use the kb CLI, which can stream stdin into a command (e.g. tar | kb exec -- 'tar -x').`;

const CREATE_DESCRIPTION = `Create a knowledge-base session: a fresh sandbox with its own checkout and branch. Call this once per task, then pass the returned session_id to kb_shell. Close it with kb_session_close when the task is done. Idle sessions are reaped after 24 hours and their unpushed work is discarded.`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const errorResult = (e: unknown) => ({
  ...text(e instanceof TransportError ? `kb: ${e.message} (transport error ${e.code})` : `kb: ${e instanceof Error ? e.message : String(e)}`),
  isError: true,
});

/** Builds an MCP server bound to one principal. The tools mirror the HTTP API exactly. */
@Injectable()
export class McpServerFactory {
  constructor(private readonly sessions: SessionsService) {}

  build(p: Principal): McpServer {
    const server = new McpServer({ name: "kb", version: "0.1.0" });
    const sessions = this.sessions;

    server.registerTool("kb_session_create", {
      title: "Create knowledge-base session",
      description: CREATE_DESCRIPTION,
      inputSchema: {
        purpose: z.string().max(500).optional().describe("What this session is for, in one line."),
      },
    }, async ({ purpose }) => {
      try {
        const s = await sessions.create(p, { purpose });
        return { ...text(`session_id: ${s.id}\nbranch: ${s.branch}\nbase_commit: ${s.base_commit}\nworkspace: /workspace`), structuredContent: { session_id: s.id, branch: s.branch, base_commit: s.base_commit } };
      } catch (e) { return errorResult(e); }
    });

    server.registerTool("kb_session_list", {
      title: "List knowledge-base sessions",
      description: "List sessions. By default only active ones, for every user.",
      inputSchema: { all: z.boolean().optional().describe("Include closed, expired and failed sessions.") },
    }, async ({ all }) => {
      const list = sessions.list({ all });
      return { ...text(list.length ? list.map((s) => `${s.id}  ${s.state.padEnd(8)} ${s.user}/${s.token_label}  ${s.purpose ?? ""}`).join("\n") : "no sessions"), structuredContent: { sessions: list } };
    });

    server.registerTool("kb_session_close", {
      title: "Close knowledge-base session",
      description: "Tear down a session's sandbox and workspace. Push first: anything not pushed is discarded.",
      inputSchema: { session_id: z.string().describe("The session to close.") },
    }, async ({ session_id }) => {
      try { const s = await sessions.close(p, session_id); return text(`session ${s.id} closed`); }
      catch (e) { return errorResult(e); }
    });

    server.registerTool("kb_shell", {
      title: "Run a command in the knowledge base",
      description: SHELL_DESCRIPTION,
      inputSchema: {
        session_id: z.string().describe("Session from kb_session_create."),
        command: z.string().min(1).describe("Shell command, run with sh -c in /workspace."),
        cwd: z.string().optional().describe("Working directory relative to /workspace."),
        timeout_ms: z.number().int().min(1000).max(600_000).optional().describe("Default 60000."),
      },
    }, async ({ session_id, command, cwd, timeout_ms }) => {
      try {
        const r = await sessions.exec(p, session_id, command, { cwd, timeoutMs: timeout_ms });
        let out = r.stdout;
        const nl = () => (out && !out.endsWith("\n") ? "\n" : "");
        if (r.stderr) out += `${nl()}--- stderr ---\n${r.stderr}`;
        if (r.exit_code !== 0) out += `${nl()}--- exit code ${r.exit_code} ---`;
        if (r.truncated) out += "\n--- output truncated ---";
        return { content: [{ type: "text" as const, text: out || "(no output)" }], structuredContent: { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code, duration_ms: r.duration_ms }, isError: false };
      } catch (e) { return errorResult(e); }
    });

    return server;
  }
}
