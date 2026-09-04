#!/usr/bin/env bash
# Runs once after the container is created. Idempotent: safe to re-run.
# Brings the whole stack up so a contributor can `lore session create` immediately.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== npm install + build"
npm install
npm run build
sudo npm install -g ./packages/cli      # vscode has passwordless sudo; the global prefix is root-owned

echo "== waiting for the docker-in-docker daemon"
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker info >/dev/null 2>&1 || { echo "docker daemon not reachable; start it and re-run this script"; exit 1; }

echo "== building images and starting the stack"
mkdir -p data
docker compose up -d --build
for i in $(seq 1 30); do curl -sf http://localhost:8480/health >/dev/null && break; sleep 1; done

echo "== bootstrapping a dev admin and logging the CLI in"
if [ ! -f data/.token-dev ]; then
  docker compose exec -T orchestrator lore-admin user create dev --admin >/dev/null 2>&1 || true
  docker compose exec -T orchestrator lore-admin token create dev devcontainer | tr -d '\r' > data/.token-dev
fi
lore login http://localhost:8480 --token "$(cat data/.token-dev)"
echo "== registering the MCP server with claude (local scope)"
claude mcp add lore -- lore mcp >/dev/null 2>&1 || true

echo
echo "ready: stack on http://localhost:8480 (docs at /docs), lore logged in as 'dev'."
echo "       npm test                                # isolated tier"
echo "       npm run test:stack -w packages/server    # stack tier"
