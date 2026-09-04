# lore

A git-backed knowledge base that AI agents and humans read and write through sandboxed
sessions. `lore` is the command-line client; `lore-server` runs the sessions. The design is in
[`spec/`](spec/README.md); this repository is its implementation.

## Use an existing lore server

Someone running a server gives you its URL and a token. Then:

```bash
npm install -g @rasmusgodske/lore                       # needs Node 22 or newer
lore login https://lore.example.com --token <token>     # saved to ~/.config/lore/config.json
lore me
```

Give your agent the same server as an MCP server. The CLI speaks MCP over stdio and relays to
the server you logged into, so no URL or token goes into the client's configuration:

```bash
claude mcp add lore -- lore mcp
```

Clients that can talk to a remote MCP server directly may skip the CLI:

```bash
claude mcp add --transport http lore https://lore.example.com/mcp --header "Authorization: Bearer <token>"
```

Tools it gets: `lore_session_create`, `lore_shell` (session_id, command), `lore_session_list`,
`lore_session_close`, and `lore_guide`. The guide to how lore works arrives as the server's
instructions on connect; the same text is `lore guide` on the command line and `GET /guide` on
the API. The Open Knowledge Format specification that documents follow is one step away from
everywhere: `lore_guide` with topic `okf`, `/usr/share/lore/OKF-SPEC.md` inside any session,
`lore guide okf`, or `GET /guide/okf`. Nothing forces an agent to read it, and nothing is
validated: a team reads once, writes its own conventions into its repository, and agents
follow those. Lore does not dictate what a repository contains.

### Connect claude.ai

claude.ai reaches the server from Anthropic's side rather than from your machine, so this needs
a server on a public HTTPS address. In **Settings → Connectors → Add → Add custom connector**,
give it a name and the URL `https://lore.example.com/mcp`, click **Next**, choose **no
authentication**, and then add a custom header:

```
Authorization: Bearer <token>
```

The "no authentication" choice refers to OAuth, which lore does not implement; the header is
what authenticates, and the connector dialog only offers the header field once OAuth is
declined. Mint a token for this alone, `lore token create claude-ai` (or, as an admin for
another user, `lore admin user token alice claude-ai`), so it can be revoked on its own: it
lives in Anthropic's connector configuration rather than on a machine you control, and every
session it opens is attributed to its user in the audit log.

Everything below is for running or developing the server.

```
packages/server/     NestJS orchestrator: sessions, exec, git smart HTTP + hook, HTTP API, MCP, lore-admin
packages/cli/        `lore`: the command-line client for humans and agents (no runtime dependencies)
sandbox/Dockerfile   the agent's environment (git, ripgrep, jq, python3, coreutils)
seed/                initial contents of the knowledge repo (index files, AGENTS.md)
openapi.json         the HTTP contract, generated from the server; the CLI's types come from it
docker-compose.yml   local run; the same shape deploys to the VM with LORE_SANDBOX_RUNTIME=runsc
deploy/              VM deployment: cloud-init, server creation, Caddy, backups, the guide
.devcontainer/       everything a contributor needs; docker-in-docker, stack started on create
data/                created on first run: knowledge.git (bare), main/ (read-only checkout of main), lore.db, sessions/
```

## Develop in the devcontainer

Open the repo in VS Code and choose "Reopen in Container". The container has node 22, git,
docker-in-docker, sqlite3, ripgrep, jq, python3, gh, claude and omp baked in; on first open
it installs dependencies, builds the images, starts the stack inside its own Docker daemon,
creates an admin user `dev`, logs the `lore` CLI in, and registers the MCP server with Claude
Code. Sandboxes run under `runc` there, since gVisor cannot run inside a nested daemon.

## Run locally without the devcontainer

```bash
docker compose up -d --build
docker compose exec orchestrator lore-admin user create <you> --admin
docker compose exec orchestrator lore-admin token create <you> laptop     # prints the token once
```

The orchestrator listens on `localhost:8480` (`LORE_PUBLIC_PORT` changes it) and serves its API
documentation at `/docs`. Sandboxes run under `runc` locally; set `LORE_SANDBOX_RUNTIME=runsc`
where gVisor is installed.

## Use the CLI against a local stack

```bash
npm install -g @rasmusgodske/lore                 # or, from this checkout: npm install -g ./packages/cli
lore login http://localhost:8480 --token <token>

export LORE_SESSION=$(lore session create --purpose "How does the nightly import retry?")
lore exec -- rg -il import topics/
lore exec -- 'cat > topics/nightly-import.md' < nightly-import.md   # stdin is streamed in
tar -C docs -c . | lore exec -- 'tar -x -C talks'                # so is a whole archive
lore exec -- 'git add -A && git commit -m "..." && git push origin HEAD'
lore session log                                                 # readable transcript; JSONL when piped
lore session close
```

`LORE_URL` and `LORE_TOKEN` override the config file, which is how scripts and agents run without
one. Exit codes: a command's own passes through; 100 to 104 with a `lore:` prefix on stderr mean
the request never ran in the sandbox (connection, auth, unknown session, timeout, bad request).

Managing the server is the `lore admin` namespace, admin-only and nothing an agent uses:
`lore admin status`, `lore admin mirror status|log|sync`, `lore admin user create|list|token`.
Admins create users and give them their first token; after that users mint their own:

```bash
lore admin user create alice && lore admin user token alice laptop
```

## Tests

```bash
npm test                                   # isolated tier: unit tests and the conventions test, no Docker
npm run test:stack -w packages/server      # stack tier: real sessions against the running compose stack
```

Tests live beside their subject (`*.spec.ts`) and declare their own cost; the stack tier skips
itself unless `LORE_TEST_URL` and `LORE_TEST_ADMIN_TOKEN` are set. `packages/server/test/conventions`
holds rules about the codebase itself, such as module boundaries.

## How it holds together

- Each session is a `git clone` of `main` on its own `session/<id>` branch, bind-mounted into a
  fresh container. Commands run there with `docker exec`, stdin streamed in when provided.
- The sandbox's `origin` is the orchestrator's own git-over-HTTP endpoint with a per-session
  token in the URL. The orchestrator maps the token to a session and sets `REMOTE_USER` for the
  hook, which allows only `session/<own-id>`, fast-forward only, and only commits that already
  contain `main`. Pushes are serialized, and `post-receive` fast-forwards `main`.
- Users, tokens, sessions and audit events are rows in `data/lore.db` (SQLite). Every audit row
  records who acted, from which IP, and up to 64 KB of each stream.
- The server is organised as NestJS modules under `packages/server/src/modules/`, each with a
  README saying what it hides and an `index.ts` that is its only importable surface.

## Deploy on a VM

See [`deploy/README.md`](deploy/README.md): one Ubuntu server with Docker, gVisor and Caddy,
created from `deploy/cloud-init.yml`, running the published images from
`ghcr.io/rasmusgodske/lore-server` and `lore-sandbox`, with nightly backups.

## Releases

A version tag publishes everything: `git tag v0.1.0 && git push origin v0.1.0` runs the tests,
pushes both images to the GitHub Container Registry, and publishes `@rasmusgodske/lore` to npm
with the same version. See `.github/workflows/release.yml`.

## Use a GitHub repository as the source of truth

Standalone, lore's own repository is the knowledge base. Set `LORE_REMOTE_URL` and
`LORE_REMOTE_TOKEN` and a git repository, for example on GitHub, becomes the source of truth
instead: every session starts from its `main`, every landing is a push to it, and a change
made on GitHub is what the next session sees. That is an off-site copy that is current within
seconds, and GitHub's file browser and history as the way to look at the knowledge.
`lore admin remote status` shows how it is going. The step-by-step, including the exact token
permissions, is in [`deploy/README.md`](deploy/README.md).

## Browse the knowledge directly

`data/main/` is a checkout of `main` that the orchestrator refreshes on boot and after every
landed push. Open it in an editor or Obsidian, grep it, but do not edit it: it is overwritten
on the next landing. Writes go through a session.

```bash
ls data/main
git clone data/knowledge.git /tmp/lore && ls /tmp/lore
git --git-dir=data/knowledge.git log --oneline main
sqlite3 data/lore.db 'select ts, session_id, op, cmd, exit_code from audit_events order by id desc limit 20'
```
