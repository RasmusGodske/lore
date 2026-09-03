# @kb/server

The orchestrator: a NestJS application that owns sessions, runs commands in sandboxes, serves
the knowledge repository over git smart HTTP, enforces the push rules, and exposes everything
as an HTTP API and an MCP endpoint. Runs as one container with the Docker socket mounted.

## Modules

Every module under `src/modules/` has a `README.md` stating what it hides and an `index.ts`
that is its only importable surface. Cross-module imports end at the module root; a
conventions test enforces it. Dependencies flow one way:

```
api ─────────────► (nothing)         HTTP contract: errors, validation, OpenAPI, /health
config, database ► (nothing)         environment; the SQLite file and schema
auth ────────────► api               users, tokens, bearer guard, admin guard
audit ───────────► config, database  append-only record of what sessions did
docker ──────────► api, config       the host Docker daemon
git ─────────────► config, docker    the bare repo, workspaces, hooks, push lock
sessions ────────► all of the above  the session lifecycle and its two entry points (HTTP, git)
mcp ─────────────► sessions, auth    the four MCP tools
```

Root-level files are framework glue: `main.ts` (boot), `app.module.ts`, `openapi.ts` (prints
the document), `admin.ts` (`kb-admin`, direct-database bootstrap run inside the container).

## Commands

```bash
npm run build          # nest build -> dist/
npm run openapi        # regenerate ../../openapi.json from the built server
npm test               # isolated tier + conventions
npm run test:stack     # stack tier against the local compose stack (needs data/.token-dev or KB_TEST_ADMIN_TOKEN)
```

## Configuration

All settings are `KB_*` environment variables validated at boot by `modules/config`. The ones
that matter locally: `KB_HOST_DATA_DIR` (the data directory as the host daemon sees it, for
bind mounts), `KB_SANDBOX_RUNTIME` (`runc` or `runsc`), `KB_ORCHESTRATOR_HOST` (the name
sandboxes use to reach this server for `git push`).
