# Working in this repository

This is the implementation of a shared agent knowledge base: a git-backed store of
markdown that AI agents and people read and write through sandboxed sessions. **The design
lives in `spec/` and is the source of truth.** Read `spec/README.md` first, then the spec
document that covers what you are about to touch. When code and spec disagree, stop and
decide which one is wrong; do not quietly work around it.

## Orientation in five minutes

```
spec/                 design: overview, architecture, session lifecycle, git model, interfaces, knowledge format
packages/server/      NestJS orchestrator. src/modules/<name>/README.md says what each module hides
packages/cli/         `kb`, the command-line client for people and agents; no runtime dependencies
sandbox/Dockerfile    the agent's environment inside a session
seed/                 initial contents of the knowledge repository (its own AGENTS.md is for agents *writing knowledge*)
openapi.json          the HTTP contract, generated from the server; the CLI's types are generated from it
docker-compose.yml    local stack; the VM uses the same shape with KB_SANDBOX_RUNTIME=runsc
.devcontainer/        the contributor box: docker-in-docker, stack started and CLI logged in on create (admin user `dev`)
data/                 runtime state (gitignored): knowledge.git (bare), main/ (read-only checkout), kb.db, sessions/
```

Two different AGENTS.md files exist on purpose. This one is for working on the **code**.
`seed/AGENTS.md` is copied into the knowledge repository and is for agents **writing knowledge**.

## Run, test, regenerate

```bash
docker compose up -d --build                     # stack on localhost:8480 (KB_PUBLIC_PORT to change); /docs has the API
docker compose exec orchestrator kb-admin user create <name> --admin
docker compose exec orchestrator kb-admin token create <name> <label>
npm install && npm run build && npm install -g ./packages/cli
kb login http://localhost:8480 --token <token>

npm test                                         # isolated tier, no Docker: unit + conventions
npm run test:stack -w packages/server            # stack tier against the running compose stack
npm run openapi                                  # after changing any route or DTO: regenerates openapi.json AND the CLI types
```

The stack tier reads the admin token from `data/.token-dev` (written by the devcontainer's
post-create script) unless `KB_TEST_ADMIN_TOKEN` is
set. If you change a route or a DTO and do not run `npm run openapi`, the CLI compiles against
a stale contract; the build does not catch that for you.

## Conventions that are enforced

The code follows the design-principles plugin (`~/.claude/plugins/cache/design-principles/`),
with the NestJS binding written from this repo. The parts a test will fail you on:

- Every module under `packages/server/src/modules/` has a `README.md` (what it hides) and an
  `index.ts` (its only importable surface). Import other modules only as `../<module>`.
- No import cycles between modules. No `common/`, `shared/`, `utils/` directories.
- Nest file naming (`x.controller.ts`, `x.service.ts`, `x.module.ts`, `dto.ts`). Only a module's
  faces carry its name: `SessionsModule`, `SessionsService`, `SessionsController`. Everything
  else is named for what it is (`PushLockService`, `SessionAccessGuard`, `ExecResultDto`).
- Tests sit beside their subject as `*.spec.ts` and declare their cost inside: nothing for the
  isolated tier, `stackTier()` from `test/support/stack.ts` for tests that need the running stack.
  Rules about the codebase go in `packages/server/test/conventions/`.
- Every DTO is built with `zodDto()` from the `api` module, not `createZodDto` directly. It
  carries a workaround: nestjs-zod emits `type: ["string","null"]` for nullable fields and
  @nestjs/swagger turns that into an array schema.
- Errors leave the server as `{ error: { code, message } }` with transport codes 100–104
  (spec 04). A command that ran and exited non-zero is a **successful** call with `exit_code` set.

## Things that bit us, so you don't rediscover them

- **Git quarantines pushed objects during pre-receive.** You cannot point `main` at a pushed
  commit from pre-receive. Landing happens in post-receive, made race-free by the orchestrator's
  push lock (`PushLockService`). Do not reintroduce a compare-and-swap in pre-receive.
- **CommonJS import cycles crash Nest at boot** with `X is not a function` / undefined
  providers. The `api` module imports nothing from other modules for this reason; keep the
  module graph a DAG (the conventions test checks it).
- **A constructor parameter with a default is still injected by Nest.** Read `process.env`
  inside the class, not as a constructor argument.
- **Decorated classes must be imported as values**, never `import type`.
- **Port 8080 was taken on the author's laptop.** The stack publishes on 8480; 8080 stays the
  internal port sandboxes use to reach `kb-orchestrator` for `git push`.
- **`KB_HOST_DATA_DIR` must be the host path** of `data/`, because sandbox bind mounts are
  created by the host daemon, not by the orchestrator container. Compose sets it from `$PWD`.
  Inside the devcontainer the daemon is docker-in-docker and sees the workspace at the same
  path, so the default just works there.
- **The sandbox network is internal** (no internet). An agent running on the same machine as
  Docker can bypass the session with `docker cp`; on the VM it cannot. The sanctioned bulk
  path is stdin: `tar -c . | kb exec -- 'tar -x'`.
- **`kb` reads stdin whenever it is not a terminal.** In scripts, add `< /dev/null` to an exec
  that must not receive input.
- **`printf` treats a leading `---` as an option.** Frontmatter written from a shell needs
  `printf -- '---\n...'` or a heredoc.
- The **push audit row is written before the push response ends**, so a log read right after
  `git push` returns sees it. Keep it that way (there is a stack test for it).

## Where things are decided

- Product and architecture decisions: `spec/`. Update the spec in the same change as the code.
- Module intent and invariants: the module's `README.md`. The README's promises are the test plan.
- Runtime facts for this machine (ports, tokens, MCP registration): Claude's project memory,
  not the repo.
