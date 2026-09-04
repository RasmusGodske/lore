import { All, Controller, Logger, Param, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { spawn } from "node:child_process";
import { Public } from "../api";
import { ConfigService } from "../config";
import { GitRepoService, PushLockService, MirrorService } from "../git";
import { AuditService } from "../audit";
import { SessionsService } from "./sessions.service";

/**
 * Git smart HTTP, served by the orchestrator itself. Each request is handed to git's
 * built-in `http-backend` CGI with REMOTE_USER set to the session that owns the token in
 * the URL. That is how the pre-receive hook learns who is pushing. Not part of the API
 * for callers; the URL only ever appears as a workspace's `origin`.
 */
@ApiExcludeController()
@Public()
@Controller("git")
export class GitHttpController {
  private readonly log = new Logger(GitHttpController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly repo: GitRepoService,
    private readonly lock: PushLockService,
    private readonly mirror: MirrorService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  @All(":token/knowledge.git/*rest")
  handle(@Param("token") token: string, @Param("rest") rest: string | string[], @Req() req: Request, @Res() res: Response): Promise<void> {
    const subpath = "/" + (Array.isArray(rest) ? rest.join("/") : rest ?? "");
    const isPush = req.method === "POST" && subpath.endsWith("git-receive-pack");
    return isPush ? this.lock.run(() => this.serve(token, subpath, req, res)) : this.serve(token, subpath, req, res);
  }

  private async serve(token: string, subpath: string, req: Request, res: Response): Promise<void> {
    const session = this.sessions.byGitToken(token);
    if (!session || session.state !== "active") {
      res.status(403).type("text/plain").send("lore: unknown or inactive session token in remote URL\n");
      return;
    }
    const url = new URL(req.originalUrl, "http://x");
    const isPush = req.method === "POST" && subpath.endsWith("git-receive-pack");
    const branchBefore = isPush ? await this.repo.refSha(session.branch) : null;
    const mainBefore = isPush ? await this.repo.refSha("refs/heads/main") : null;

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: this.config.dataDir,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/knowledge.git${subpath}`,
      REQUEST_METHOD: req.method,
      QUERY_STRING: url.search.replace(/^\?/, ""),
      REMOTE_USER: session.id,
      REMOTE_ADDR: req.ip ?? "",
      CONTENT_TYPE: req.headers["content-type"] ?? "",
      CONTENT_LENGTH: req.headers["content-length"] ?? "",
      HTTP_CONTENT_ENCODING: (req.headers["content-encoding"] as string) ?? "",
      GIT_HTTP_MAX_REQUEST_BUFFER: "100M",
    };

    let finished!: () => void;
    const settled = new Promise<void>((r) => { finished = r; });
    const child = spawn("git", ["http-backend"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (b) => stderr.push(b));
    req.pipe(child.stdin);

    let headerBuf = Buffer.alloc(0);
    let headersDone = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (headersDone) { res.write(chunk); return; }
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const idx = headerBuf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      let status = 200;
      for (const h of headerBuf.subarray(0, idx).toString("latin1").split("\r\n")) {
        const [k, ...v] = h.split(":");
        const val = v.join(":").trim();
        if (k.toLowerCase() === "status") status = parseInt(val, 10) || 200;
        else res.setHeader(k, val);
      }
      res.status(status);
      headersDone = true;
      const body = headerBuf.subarray(idx + 4);
      if (body.length) res.write(body);
    });

    child.on("close", async (code) => {
      // Bookkeeping happens before the response ends, so a caller that reads the audit log
      // right after `git push` returns sees the push event.
      this.sessions.touch(session.id);
      if (isPush) {
        const branchAfter = await this.repo.refSha(session.branch);
        const accepted = branchAfter !== branchBefore;
        if (accepted && branchAfter && !(await this.repo.fastForwardMain(branchAfter))) {
          this.log.error(`push accepted but main could not be fast-forwarded (session ${session.id}, ${branchAfter})`);
        }
        const mainAfter = await this.repo.refSha("refs/heads/main");
        if (accepted && mainAfter !== mainBefore) { await this.repo.afterLanding(); this.mirror.schedule(0); }
        this.audit.record({
          session_id: session.id, op: "push", user_id: session.user_id, token_id: session.token_id, remote_ip: req.ip,
          extra: { branch: session.branch, result: accepted ? "accepted" : "rejected", before: branchBefore, after: branchAfter, main_before: mainBefore, main_after: mainAfter },
        });
        this.log.log(`push ${session.id} ${accepted ? "accepted" : "rejected"} main=${mainAfter?.slice(0, 7)}`);
      }
      if (code !== 0) this.log.warn(`http-backend exited ${code}: ${Buffer.concat(stderr).toString().trim()}`);
      if (!headersDone) res.status(500).type("text/plain").send(`lore: git http-backend failed (${code}): ${Buffer.concat(stderr)}`);
      else res.end();
      finished();
    });
    await settled;
  }
}
