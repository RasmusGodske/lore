# Shared agent knowledge base

A git-backed knowledge base that AI agents and humans read and write through sandboxed
sessions. The design is in [`spec/`](spec/README.md); this repository is its implementation.

```
packages/server/     NestJS orchestrator: sessions, exec, git smart HTTP + hook, HTTP API, MCP, kb-admin
packages/cli/        `kb`: the command-line client for humans and agents (no runtime dependencies)
sandbox/Dockerfile   the agent's environment (git, ripgrep, jq, python3, coreutils)
seed/                initial contents of the knowledge repo (index files, AGENTS.md)
openapi.json         the HTTP contract, generated from the server; the CLI's types come from it
docker-compose.yml   local run; the same shape deploys to the VM with KB_SANDBOX_RUNTIME=runsc
.devcontainer/       everything a contributor needs; docker-in-docker, stack started on create
data/                created on first run: knowledge.git (bare), main/ (read-only checkout of main), kb.db, sessions/
```

## Develop in the devcontainer

Open the repo in VS Code and choose "Reopen in Container". The container has node 22, git,
docker-in-docker, sqlite3, ripgrep, jq, python3, gh, claude and omp baked in; on first open
it installs dependencies, builds the images, starts the stack inside its own Docker daemon,
creates an admin user `dev`, logs the `kb` CLI in, and registers the MCP server with Claude
Code. Sandboxes run under `runc` there, since gVisor cannot run inside a nested daemon.

## Run locally without the devcontainer

```bash
docker compose up -d --build
docker compose exec orchestrator kb-admin user create <you> --admin
docker compose exec orchestrator kb-admin token create <you> laptop     # prints the token once
```

The orchestrator listens on `localhost:8480` (`KB_PUBLIC_PORT` changes it) and serves its API
documentation at `/docs`. Sandboxes run under `runc` locally; set `KB_SANDBOX_RUNTIME=runsc`
where gVisor is installed.

## Use the CLI

```bash
npm install && npm run build
npm install -g ./packages/cli                     # puts `kb` on your PATH
kb login http://localhost:8480 --token <token>    # saved to ~/.config/kb/config.json

export KB_SESSION=$(kb session create --purpose "How does the nightly import retry?")
kb exec -- rg -il import topics/
kb exec -- 'cat > topics/nightly-import.md' < nightly-import.md   # stdin is streamed in
tar -C docs -c . | kb exec -- 'tar -x -C talks'                # so is a whole archive
kb exec -- 'git add -A && git commit -m "..." && git push origin HEAD'
kb session log                                                 # readable transcript; JSONL when piped
kb session close
```

`KB_URL` and `KB_TOKEN` override the config file, which is how scripts and agents run without
one. Exit codes: a command's own passes through; 100 to 104 with a `kb:` prefix on stderr mean
the request never ran in the sandbox (connection, auth, unknown session, timeout, bad request).

Admins create users and give them their first token; after that users mint their own:

```bash
kb user create alice && kb user token alice laptop
```

## Connect an agent over MCP

```bash
claude mcp add --transport http kb http://localhost:8480/mcp --header "Authorization: Bearer <token>"
```

Tools: `kb_session_create`, `kb_shell` (session_id, command), `kb_session_list`, `kb_session_close`.
An agent that also has a shell can use `kb` directly, which is the path for bulk file transfer.
The working instructions agents follow live in the knowledge repo itself, at `AGENTS.md`.

## Tests

```bash
npm test                                   # isolated tier: unit tests and the conventions test, no Docker
npm run test:stack -w packages/server      # stack tier: real sessions against the running compose stack
```

Tests live beside their subject (`*.spec.ts`) and declare their own cost; the stack tier skips
itself unless `KB_TEST_URL` and `KB_TEST_ADMIN_TOKEN` are set. `packages/server/test/conventions`
holds rules about the codebase itself, such as module boundaries.

## How it holds together

- Each session is a `git clone` of `main` on its own `session/<id>` branch, bind-mounted into a
  fresh container. Commands run there with `docker exec`, stdin streamed in when provided.
- The sandbox's `origin` is the orchestrator's own git-over-HTTP endpoint with a per-session
  token in the URL. The orchestrator maps the token to a session and sets `REMOTE_USER` for the
  hook, which allows only `session/<own-id>`, fast-forward only, and only commits that already
  contain `main`. Pushes are serialized, and `post-receive` fast-forwards `main`.
- Users, tokens, sessions and audit events are rows in `data/kb.db` (SQLite). Every audit row
  records who acted, from which IP, and up to 64 KB of each stream.
- The server is organised as NestJS modules under `packages/server/src/modules/`, each with a
  README saying what it hides and an `index.ts` that is its only importable surface.

## Browse the knowledge directly

`data/main/` is a checkout of `main` that the orchestrator refreshes on boot and after every
landed push. Open it in an editor or Obsidian, grep it, but do not edit it: it is overwritten
on the next landing. Writes go through a session.

```bash
ls data/main
git clone data/knowledge.git /tmp/kb && ls /tmp/kb
git --git-dir=data/knowledge.git log --oneline main
sqlite3 data/kb.db 'select ts, session_id, op, cmd, exit_code from audit_events order by id desc limit 20'
```
