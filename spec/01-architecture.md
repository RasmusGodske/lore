# 01 — Architecture

## Components

Three things run on one host VM.

| Component | What it is | Where it runs |
|---|---|---|
| **Bare repository** | The permanent knowledge base. A bare git repo plus its `hooks/` directory. | Host filesystem, e.g. `/srv/lore/knowledge.git` |
| **Orchestrator** | The application, one NestJS process. Creates sessions, spawns sandboxes, tracks state, writes the audit log, serves the HTTP API, MCP and OpenAPI document, and serves the bare repo over git smart HTTP (`git http-backend` + pre-receive hook). | One container |
| **Session sandboxes** | One short-lived container per session, where the agent's commands actually run. | Sibling containers, gVisor runtime (`runc` in local development) |

## Stack

TypeScript on Node 22, one process: a NestJS 11 application on the Express 5 adapter,
dockerode for Docker, the official `@modelcontextprotocol/sdk` for MCP, SQLite for state.
NestJS was chosen over plain Express because it is opinionated: there is one documented way
to do each thing (modules, controllers, providers, guards, pipes, filters), so an agent
working on the code already knows the conventions. Request validation and the OpenAPI
document both come from zod schemas, via `nestjs-zod` and `@nestjs/swagger`; the document
is served at `/docs` (Swagger UI) and `/docs/openapi.json`, and committed at the repo root
as `openapi.json`. The HTTP API and the MCP endpoint are two routes on the same process
over the same core library; the git endpoint is a third route that spawns
`git http-backend` as a CGI process.

### Code layout

The repo is an npm workspace with two packages beside `sandbox/Dockerfile`, `seed/`
(initial knowledge repo contents) and `docker-compose.yml`:

- `packages/server` — the orchestrator, organised as
  `src/modules/{api,auth,audit,config,database,docker,git,sessions,mcp}`. Every module has
  a `README.md` and an `index.ts` that is its only importable surface; a conventions test
  enforces that no module imports another's internals and that there are no cycles.
- `packages/cli` — the `lore` binary: a dependency-free HTTP client whose types are generated
  from `openapi.json`. See `04-interfaces.md`.

### Tests

Two tiers, both co-located with their subject as `*.spec.ts`. Isolated unit tests (hook
rules, audit rendering, CLI argument and output handling, client error mapping) run with
`npm test`. Stack-tier tests drive a running orchestrator over HTTP with real sandboxes;
they skip themselves unless `LORE_TEST_URL` and `LORE_TEST_ADMIN_TOKEN` are set, and
`npm run test:stack` in `packages/server` runs them against the local compose stack. The
module-boundary conventions test lives under `packages/server/test/conventions`.

## Topology

```
                          Host VM (Docker + gVisor installed)
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  ┌────────────────────────────────────────────────┐                  │
  │  │  Orchestrator (one container, one process)     │                  │
  │  │                                                │                  │
  │  │  :8080  /sessions…  HTTP API                   │                  │
  │  │         /mcp        MCP (streamable HTTP)      │                  │
  │  │         /docs       OpenAPI UI + JSON          │                  │
  │  │         /git/<git-token>/knowledge.git         │◄───┐             │
  │  │           git http-backend + pre-receive hook  │    │             │
  │  │                                                │    │ git over    │
  │  │  SQLite: users, tokens, sessions, audit        │    │ HTTP        │
  │  └─────────┬──────────────────────────────────────┘    │             │
  │            │                                           │             │
  │            │ /var/run/docker.sock                      │             │
  │            ▼                                           │             │
  │  ┌──────────────────────────────────────────┐          │             │
  │  │  Host Docker daemon                      │          │             │
  │  └─────────┬────────────────────────────────┘          │             │
  │            │ spawns siblings                           │             │
  │  ┌─────────▼──────────┐  ┌──────────────────┐          │             │
  │  │ sandbox:sess-abc   │  │ sandbox:sess-xyz │──────────┘             │
  │  │ --runtime=runsc    │  │ --runtime=runsc  │  (lore-net, --internal)  │
  │  │ /workspace mounted │  │ /workspace       │                        │
  │  └────────────────────┘  └──────────────────┘                        │
  │                                                                      │
  │  /srv/lore/knowledge.git    ← bare repository, never mounted in sandbox│
  │  /srv/lore/sessions/<id>/   ← per-session working directories          │
  │  /srv/lore/lore.db            ← SQLite state and audit                   │
  └──────────────────────────────────────────────────────────────────────┘
```

Session containers are **siblings** of the orchestrator, not children. The orchestrator
asks the host's Docker daemon to create them.

## Isolation: gVisor

Standard Docker containers share the host kernel. A container escape reaches the host.
gVisor (`runsc`) inserts a user-space kernel between the container and the host: every
syscall the container makes is intercepted and handled by gVisor's own implementation, and
only a small, controlled set reaches the real host kernel. The process inside believes it is
talking to an ordinary Linux kernel and behaves normally.

This is what removes the need to validate commands. The agent can run anything; the boundary
holds regardless.

### Host setup (one time)

gVisor is host infrastructure, not something baked into an image.

```bash
# Download runsc and place it in /usr/local/bin (see gvisor.dev/docs/user_guide/install)
sudo /usr/local/bin/runsc install     # writes the runtime entry into /etc/docker/daemon.json
sudo systemctl reload docker
docker run --rm --runtime=runsc hello-world   # verify
```

After this, any container can opt into gVisor with a single flag. Nothing else about
building, pushing, or running images changes.

### Using it

```bash
docker run -d \
  --runtime=$LORE_SANDBOX_RUNTIME \
  --name lore-sess-<id> \
  --network lore-net \
  --user 1000 \
  --cap-drop ALL \
  --read-only \
  --tmpfs /tmp \
  --memory 1g --cpus 1 \
  --pids-limit 256 \
  -v /srv/lore/sessions/<id>:/workspace \
  -e LORE_SESSION_ID=<id> \
  lore-sandbox:latest \
  sleep infinity
```

Notes:

- `LORE_SANDBOX_RUNTIME` is a config flag: `runsc` on the VM, `runc` for local development
  where gVisor is not installed. Nothing else differs between the two.
- `--user 1000 --cap-drop ALL`: an unprivileged user with no capabilities. The workspace
  directory is owned by uid 1000 on the host side.
- `--read-only` on the root filesystem, with `/workspace` and `/tmp` writable. The agent
  should not be modifying its own toolchain.
- Resource limits are defence against runaway scripts, not against attackers.
- `--network lore-net` gives reachability to the orchestrator's git endpoint and nothing
  else. See below.

## Network

Sandboxes need exactly one thing from the network: the orchestrator's git endpoint.
`lore-net` is a Docker `--internal` network: the orchestrator and the sandboxes are attached
to it, it has no route to the outside, and sandboxes are attached to nothing else.

So sandboxes have no internet access. Denying it removes a class of exfiltration and
prompt-injection risk; the cost is that an agent cannot fetch a referenced URL and file it
into the wiki. Decided: denied. Revisit if it turns out to be limiting.

### Two things the network does not do on its own

Sandboxes resolve `lore-server` from an entry the orchestrator writes into their hosts
file, not from Docker's DNS: under gVisor the container cannot reach Docker's embedded
resolver. The address is the orchestrator's own on the sandbox network, since it is also
attached to the default network and a plain lookup returns that address instead.

An internal network stops routing out, but the host's own listeners remain reachable through
the bridge gateway. The bridge therefore has a fixed name, `lore-net`, and the host firewall
refuses everything arriving from it, ahead of any allow rule (see `deploy/`). Verified from a
session on the VM: the internet, the public address, and the gateway are unreachable; the
orchestrator's git endpoint is.

## The orchestrator container

Bundled as one image, deployed with one `docker run`. It needs two mounts:

```bash
docker run -d \
  --name lore-server \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/lore:/srv/lore \
  -e LORE_SANDBOX_RUNTIME=runsc \
  -p 8080:8080 \
  lore-server:latest
docker network connect lore-net lore-server
```

The orchestrator sits on two networks: the default bridge, so `-p 8080:8080` works (an
`--internal` network cannot publish ports), and `lore-net`, where sandboxes reach it as
`lore-server:8080`. `docker-compose.yml` in the repo does the same for local
development with `LORE_SANDBOX_RUNTIME=runc`.

**The Docker socket mount is the significant one.** The Docker CLI is only a client; all
real work is done by a background daemon on the host, reached over a Unix socket. Mounting
that socket into the orchestrator lets it ask the host daemon to create and destroy
containers. It also means the orchestrator has host-level authority over Docker generally,
not a scoped subset. For an internal tool on our own infrastructure this is an acceptable
trade; it would not be acceptable if the orchestrator ran untrusted code.

From the host's perspective, one container is running. Session containers appear and
disappear underneath it without the operator needing to think about them.

## Two images

**`lore-server`** — the application: one Node 22 (NestJS) process with session management,
SQLite state and audit log, HTTP API, MCP endpoint, and the git smart HTTP route. Needs
git (for `http-backend` and workspace clones) and the Docker socket.

**`lore-sandbox`** — the agent's environment, run as uid 1000. Whatever tools the agent
should have:
`git`, `ripgrep`, `jq`, `python3`, `coreutils`, `sed`, `awk`, an editor if wanted. This
image *is* the tool policy. There is no separate tool registration anywhere; if it is in the
image, the agent has it.

Keep the sandbox image small and cached on the host so container start stays fast.

## Performance

| Stage | Expected |
|---|---|
| Normal container start (image cached) | 200–500ms |
| gVisor overhead on top | ~100ms |
| Workspace preparation (local `git clone`) | depends on repo size, small for markdown |
| **Total session creation** | **roughly 0.5–1.5s** |

Acceptable as-is. If it needs to be faster, keep a **warm pool**: two or three sandbox
containers pre-started and idle, handed out on demand and replaced in the background. That
gets session creation down to the cost of preparing the workspace.

gVisor adds roughly 10–30% I/O overhead versus native. Irrelevant for markdown files.

## Scaling

One VM is expected to be sufficient indefinitely at current team size. If it ever is not,
the same pattern moves to Kubernetes with a gVisor `RuntimeClass` and the Agent Sandbox
controller, which also provides warm pools. Do not build for this now.

## Failure modes worth handling

- **Host Docker unavailable.** Orchestrator cannot create sessions. Return a transport
  error (see `04-interfaces.md`), do not pretend the session exists.
- **Orchestrator restarts with sessions live.** Session state must survive restart. Persist
  it in SQLite at `/srv/lore/lore.db`, not only in memory. On boot, reconcile: any container
  that no longer exists marks its session dead.
- **Sandbox dies mid-session.** Workspace on the host survives, since it is a bind mount.
  Either re-attach a new container to the same workspace, or mark the session failed and
  leave the directory for inspection until the reaper removes it (`02-session-lifecycle.md`).
- **Disk fills with abandoned workspaces.** Handled by the reaper in
  `02-session-lifecycle.md`.
