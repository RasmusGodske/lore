import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigService } from "../config";
import { git, gitOrThrow, run } from "./shell";
import { SANDBOX_UID } from "../docker";
import { planRefresh, type RefreshPlan } from "./remote-plan";

export interface WorkspaceSnapshot { status: string; diffstat: string; unpushed: string }

/** The bare knowledge repository and the per-session workspaces cloned from it. */
@Injectable()
export class GitRepoService implements OnModuleInit {
  private readonly log = new Logger(GitRepoService.name);
  constructor(private readonly config: ConfigService) {}

  async onModuleInit() { await this.ensureRepo(); }

  /**
   * Create the bare repo if missing; always (re)install the hooks. Standalone: seed it. With a
   * remote configured: take the remote's main if it has one, otherwise seed and let the first
   * refresh push the seed to the remote, so an empty GitHub repository becomes a bundle root.
   */
  async ensureRepo(): Promise<void> {
    const repo = this.config.repoPath;
    fs.mkdirSync(this.config.sessionsDir, { recursive: true });
    if (!fs.existsSync(path.join(repo, "HEAD"))) {
      this.log.log(`creating bare knowledge repo at ${repo}`);
      fs.mkdirSync(repo, { recursive: true });
      await gitOrThrow(["init", "--bare", "--initial-branch=main", repo]);
      const remoteMain = this.config.remote ? await this.fetchRemoteMain().catch((e) => { this.log.warn(`remote not reachable at first boot: ${String(e)}`); return null; }) : null;
      if (remoteMain) {
        await gitOrThrow(["--git-dir", repo, "update-ref", "refs/heads/main", remoteMain]);
        this.log.log(`took main from the remote (${remoteMain.slice(0, 7)})`);
      } else {
        await this.seed();
      }
    }
    const hooksDir = path.join(repo, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const name of ["pre-receive", "post-receive"]) {
      const shim = `#!/bin/sh\n# Installed by lore-server on boot. Edit packages/server/src/git/hook.ts instead.\nexec node ${this.config.env.LORE_HOOK_SCRIPT} ${name}\n`;
      fs.writeFileSync(path.join(hooksDir, name), shim, { mode: 0o755 });
      fs.chmodSync(path.join(hooksDir, name), 0o755);
    }
    await gitOrThrow(["--git-dir", repo, "config", "receive.denyDeletes", "true"]);
    await gitOrThrow(["--git-dir", repo, "config", "receive.denyNonFastForwards", "true"]);
    await this.refreshMainCheckout();
  }

  /**
   * Keep `<data>/main` equal to the bare repo's main. It is a plain clone, reset hard on every
   * landed push and on boot, so people can read the knowledge as files (an editor, Obsidian,
   * `rg`). It is not a place to write: edits there are overwritten on the next landing.
   */
  async refreshMainCheckout(): Promise<void> {
    const dir = this.config.mainCheckoutPath;
    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.rmSync(dir, { recursive: true, force: true });
      await gitOrThrow(["clone", "--quiet", "--branch", "main", this.config.repoPath, dir]);
      fs.writeFileSync(path.join(dir, ".git", "lore-read-only"), "This checkout mirrors main and is overwritten on every landed push. Write through a session.\n");
    } else {
      // The data directory can move (it did when the tool was renamed); keep origin pointing at the repo.
      await gitOrThrow(["remote", "set-url", "origin", this.config.repoPath], { cwd: dir });
      await gitOrThrow(["fetch", "--quiet", "origin", "main"], { cwd: dir });
      await gitOrThrow(["reset", "--quiet", "--hard", "origin/main"], { cwd: dir });
    }
    const chown = await run("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_UID}`, dir]);
    if (chown.code !== 0) this.log.warn(`chown of ${dir} failed: ${chown.stderr.trim()}`);
  }

  private async seed(): Promise<void> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lore-seed-"));
    try {
      await gitOrThrow(["clone", "--quiet", this.config.repoPath, tmp]);
      const seedDir = this.config.env.LORE_SEED_DIR;
      if (fs.existsSync(seedDir)) fs.cpSync(seedDir, tmp, { recursive: true });
      else fs.writeFileSync(path.join(tmp, "index.md"), '---\ntitle: Knowledge base\nokf_version: "0.2"\n---\n');
      const env = { GIT_AUTHOR_NAME: "lore", GIT_AUTHOR_EMAIL: "lore@localhost", GIT_COMMITTER_NAME: "lore", GIT_COMMITTER_EMAIL: "lore@localhost" };
      await gitOrThrow(["add", "-A"], { cwd: tmp });
      await gitOrThrow(["commit", "--quiet", "-m", "Initial knowledge base"], { cwd: tmp, env });
      await gitOrThrow(["push", "--quiet", "origin", "HEAD:main"], { cwd: tmp }); // hooks not installed yet
      this.log.log(`seeded knowledge repo from ${seedDir}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  async refSha(ref: string): Promise<string | null> {
    const r = await git(["--git-dir", this.config.repoPath, "rev-parse", "--verify", "--quiet", ref]);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /** Environment for git commands that talk to the remote: credentials via a helper, never in argv. */
  private remoteEnv(): NodeJS.ProcessEnv {
    const r = this.config.remote!;
    return { LORE_REMOTE_USERNAME: r.username, LORE_REMOTE_TOKEN: r.token, GIT_TERMINAL_PROMPT: "0" };
  }
  private static readonly CREDENTIAL_HELPER = '!f() { echo "username=$LORE_REMOTE_USERNAME"; echo "password=$LORE_REMOTE_TOKEN"; }; f';

  /** The remote's main, or null if the remote has no main branch yet. Throws if unreachable. */
  async fetchRemoteMain(): Promise<string | null> {
    const r = this.config.remote!;
    const res = await git(["--git-dir", this.config.repoPath, "-c", `credential.helper=${GitRepoService.CREDENTIAL_HELPER}`, "fetch", "--quiet", r.url, "+refs/heads/main:refs/remotes/lore-remote/main"], { env: this.remoteEnv() });
    if (res.code === 0) return (await this.refSha("refs/remotes/lore-remote/main"));
    if (/couldn't find remote ref|no such ref/i.test(res.stderr)) return null;
    throw new Error(res.stderr.trim().split("\n").slice(-2).join(" | ") || `git fetch exited ${res.code}`);
  }

  /** Push a commit to the remote's main, fast-forward only. Throws with git's message on refusal. */
  async pushMainToRemote(sha: string): Promise<void> {
    const r = this.config.remote!;
    const res = await git(["--git-dir", this.config.repoPath, "-c", `credential.helper=${GitRepoService.CREDENTIAL_HELPER}`, "push", "--quiet", r.url, `${sha}:refs/heads/main`], { env: this.remoteEnv() });
    if (res.code !== 0) throw new Error(res.stderr.trim().split("\n").slice(-2).join(" | ") || `git push exited ${res.code}`);
    await gitOrThrow(["--git-dir", this.config.repoPath, "update-ref", "refs/remotes/lore-remote/main", sha]);
  }

  /**
   * Bring local main in step with the remote: fetch, then fast-forward local main to the remote's,
   * or push lore's main if the remote is still empty. Returns what was done. "diverged" means
   * both moved independently and an operator must reconcile; nothing is forced.
   */
  async refreshFromRemote(): Promise<RefreshPlan & { newCommits?: number }> {
    const remote = await this.fetchRemoteMain();
    const local = await this.refSha("refs/heads/main");
    const repo = this.config.repoPath;
    const isAncestor = async (a: string, b: string) => (await git(["--git-dir", repo, "merge-base", "--is-ancestor", a, b])).code === 0;
    const localInRemote = local && remote && local !== remote ? await isAncestor(local, remote) : false;
    const remoteInLocal = local && remote && local !== remote ? await isAncestor(remote, local) : false;
    const plan: RefreshPlan = planRefresh(local, remote, (a, b) => (a === local && b === remote ? localInRemote : remoteInLocal));
    if (plan.kind === "fast-forward") {
      const count = local ? Number((await git(["--git-dir", repo, "rev-list", "--count", `${local}..${plan.to}`])).stdout.trim() || 0) : 1;
      await gitOrThrow(["--git-dir", repo, "update-ref", "refs/heads/main", plan.to, ...(local ? [local] : [])]);
      await this.afterLanding();
      return { ...plan, newCommits: count };
    }
    if (plan.kind === "push-local") await this.pushMainToRemote(plan.sha);
    return plan;
  }

  /** Fast-forward main to sha if sha descends from it. Backstop for the post-receive hook. */
  async fastForwardMain(sha: string): Promise<boolean> {
    const main = await this.refSha("refs/heads/main");
    if (!main || main === sha) return true;
    const repo = this.config.repoPath;
    if ((await git(["--git-dir", repo, "merge-base", "--is-ancestor", main, sha])).code !== 0) return false;
    return (await git(["--git-dir", repo, "update-ref", "refs/heads/main", sha, main])).code === 0;
  }

  /** After a push has landed (by post-receive or the backstop), bring the browsable checkout up to date. */
  async afterLanding(): Promise<void> {
    try { await this.refreshMainCheckout(); }
    catch (e) { this.log.error(`could not refresh main checkout: ${String(e)}`); }
  }

  /** Clone main into a fresh workspace on the session branch, origin pointing at the token URL. */
  async prepareWorkspace(id: string, gitToken: string, userName: string): Promise<{ baseCommit: string }> {
    const ws = this.config.workspacePath(id);
    if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
    await gitOrThrow(["clone", "--quiet", "--branch", "main", this.config.repoPath, ws]);
    const baseCommit = (await gitOrThrow(["rev-parse", "HEAD"], { cwd: ws })).trim();
    await gitOrThrow(["checkout", "--quiet", "-b", `session/${id}`], { cwd: ws });
    await gitOrThrow(["remote", "set-url", "origin", this.config.gitRemoteUrl(gitToken)], { cwd: ws });
    await gitOrThrow(["config", "user.name", `${userName} (session ${id})`], { cwd: ws });
    await gitOrThrow(["config", "user.email", `${userName}@lore`], { cwd: ws });
    await gitOrThrow(["config", "push.default", "current"], { cwd: ws });
    const chown = await run("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_UID}`, ws]);
    if (chown.code !== 0) this.log.warn(`chown of ${ws} failed: ${chown.stderr.trim()}`);
    return { baseCommit };
  }

  /** What would be lost if the workspace were deleted now. */
  async snapshot(id: string): Promise<WorkspaceSnapshot> {
    const ws = this.config.workspacePath(id);
    if (!fs.existsSync(ws)) return { status: "", diffstat: "", unpushed: "" };
    const status = (await git(["status", "--porcelain"], { cwd: ws })).stdout;
    const diffstat = (await git(["diff", "--stat"], { cwd: ws })).stdout;
    const main = await this.refSha("refs/heads/main"); // the bare repo's main; origin/main in the workspace goes stale
    const unpushed = main ? (await git(["log", "--oneline", `${main}..HEAD`], { cwd: ws })).stdout : "";
    return { status, diffstat, unpushed };
  }

  deleteWorkspace(id: string): void {
    fs.rmSync(this.config.workspacePath(id), { recursive: true, force: true });
  }
}
