#!/usr/bin/env bash
# Copy this checkout to the server without a git remote (useful before the repo is published,
# or to deploy uncommitted work). Excludes runtime state and build output.
#   deploy/sync.sh deploy@203.0.113.10
set -euo pipefail
HOST="${1:?user@host}"
cd "$(dirname "$0")/.."
rsync -az --delete \
  --exclude data/ --exclude node_modules/ --exclude '*/node_modules/' --exclude '*/dist/' \
  --exclude .git/ --exclude .env \
  ./ "$HOST:/srv/lore/"
echo "synced to $HOST:/srv/lore"
