# 00 — Overview

## The problem

A small team's working knowledge lives in people's heads and in systems that have to be
re-queried every time. Support, operations and product work all depend on context that
nothing currently remembers:

- **Recurring questions are answered from zero.** When someone asks "what happens if we
  change this setting?", nobody remembers how that part of the system is actually
  configured. Every question starts over: open the codebase, query the production
  database, find the relevant records, reconstruct the situation.
- **Context does not survive a session.** A Claude Code session that works out how a
  specific integration is configured, decides an approach, and drafts a reply produces
  nothing durable. The next time the question comes up, the same archaeology starts again.
- **Nothing is shared between people.** Work done in one person's local agent session is
  invisible to the others.
- **Internal system knowledge has the same problem.** "How does this feature actually
  work, and what is worth knowing before touching it?" is as valuable to capture as the
  answer to any external question.

Existing agent tooling partly covers this. Claude Code already has codebase access and can
query the production database directly, which works well. What is missing is a durable,
shared place to put what those investigations conclude.

## What this system is

A shared knowledge base that:

1. Stores knowledge as plain markdown files in a git repository, following the Open
   Knowledge Format (OKF).
2. Is readable and writable by AI agents through sandboxed sessions.
3. Is equally readable and writable by humans, through a terminal, an editor, or any
   markdown tool, with no dependency on the agent layer.
4. Records what every agent session did, for audit and for later analysis.

Scope covers both operational knowledge (how a system is configured, how a partner
integration is set up, what was concluded about a recurring question) and internal
knowledge (how features work, what to watch out for, architectural context). Think company
wiki, not ticket tracker.

## Design principles

**The filesystem is the source of truth.** Not a database with a filesystem-shaped
abstraction over it. A directory of markdown files that any tool — `grep`, `cat`, an
editor, Obsidian over SFTP, a script — can operate on without going through this system.
If this system disappears, the knowledge is still fully usable.

**Give agents the tools they already know.** Do not build bespoke `move_file`,
`search_knowledge`, `list_directory` operations. Agents are already fluent in `rg`, `ls`,
`cat`, `sed`, `git`. Expose a sandboxed shell and they get all of it for free, including
composition (pipes, `xargs`, `jq`) that a hand-built tool surface could never match.

**Git is the interface for merging, deliberately.** Not because git is the only way to
reconcile changes, but because agents already understand `push rejected: non-fast-forward`,
conflict markers, and "merge and resolve". Reusing that vocabulary means no new semantics
to teach. The model is a junior developer on a protected branch: work freely on your own
branch, and it is your job to arrive at something mergeable.

**Enforcement lives where the agent cannot reach it.** Rules are enforced by a server-side
git hook, not by validating commands before they run. There is no allowlist of permitted
commands to maintain and no command-approval layer.

**Isolation by boundary, not by inspection.** The sandbox does not judge what the agent
runs. It guarantees that whatever the agent runs cannot reach the host, other sessions, or
anything outside its workspace.

**Everything goes through a session.** Including reads, and including bulk imports, which
arrive as a command's stdin rather than through any side door. Slightly more overhead per
interaction, in exchange for a complete audit trail of what agents accessed and did.

**Self-hosted and portable.** Runs on a VM under our control. No dependency on GitHub,
GitLab, or any SaaS. Optional mirroring to GitHub for backup is a separate concern.

**Do not overbuild against the spec.** OKF is young and will change. Keep custom logic
about frontmatter and structure to a minimum so a spec revision does not invalidate the
implementation.

## Goals

- A small team and their agents share one knowledge base with no divergence.
- An agent answering a recurring question finds the accumulated context in one place
  instead of reconstructing it from code and databases.
- Session creation is fast enough not to be noticed. Target under 1.5s, ideally under 500ms
  with a warm pool.
- Deployable as a single container image plus a one-time host setup.
- Full audit trail: every session, every command, who ran it and from where, success and
  failure.
- Every session attributable to a user and to the named token that created it.
- **Later:** a web UI for audit browsing, session listing, file browsing, and user and
  token management. Not in the first version.

## Non-goals

- Multi-tenant isolation between mutually untrusted parties. All sessions are our own
  agents working on our own knowledge.
- A web UI in the first version. Browsing happens via terminal, editor, or Obsidian over a
  mounted directory; the UI planned later is for audit and administration, not editing.
- Replacing the codebase or production database as sources of truth. This stores
  conclusions and context, not primary data.
- Human review gates before writes land. Agents write directly; mistakes are corrected
  after the fact, and git history makes them recoverable.
- Solving retrieval quality. This is durable storage with git semantics. Search is
  `rg` for now; indexing can be layered on later.

## Rejected alternatives, and why

**A database behind MCP tools.** Would require reimplementing move, search, and multi-file
editing as bespoke tools, and would throw away the main benefit of the format being plain
files. Rejected in favour of a real filesystem.

**SSH access to a shared directory, no session layer.** Simple and gives all shell tools
for free, but some agent environments cannot use SSH, there is no audit trail, and
concurrent writes have no referee. The sandbox-plus-git model keeps the shell benefits and
adds both.

**Plain git worktrees with no container.** Fast (worktree creation is near-instant) but
provides only filesystem separation, not process or resource isolation. A runaway script in
a session could affect the host. Rejected because containers cost roughly a second and
remove the whole class of problem.

**True Docker-in-Docker for the orchestrator.** Gives cleaner isolation of the orchestrator
itself and hides session containers from the host's `docker ps`. Rejected because nesting
gVisor inside an inner Docker daemon is fragile and needs special privileges. The
isolation that matters is around the agent's code, not around the orchestrator.

**Gitea or another full git server.** Gives branch protection rules, pull requests, and a
web UI out of the box. Rejected as heavier than needed: the rules we want are a short hook
script, and the UI we eventually want is for audit and administration, not code hosting.
Reconsider if the rule set grows complicated.

**Building on an existing OKF MCP server** (`fellowgeek/mcp-memory`, `hdean-ssp/okf-mcp`,
`zosmaai/pi-llm-wiki`). All are early, none show meaningful adoption, and none match the
sandbox-and-session model. `zosmaai/pi-llm-wiki` is worth watching as a reference
implementation of OKF-native tooling.

## OPEN questions

- **Bootstrapping.** Seed from existing sources (Slack history, support email, production
  database) or start empty and accumulate? Currently assumed: start empty.
- **Write discipline.** Agents rarely document well unprompted. The instructions that tell
  an agent when and what to write are as important as this infrastructure and are not
  specified here. See `05-knowledge-format.md` for where those instructions live.
- **Retrieval at scale.** `rg` over a few hundred files is fine. Past that, an index is
  needed. Deferred.
