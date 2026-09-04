#!/usr/bin/env bash
# Restore data/ from an archive made by backup.sh. Stops the stack, replaces the database and
# the bare repository, starts the stack (which rebuilds data/main and reinstalls the hooks).
#   deploy/restore.sh /var/backups/lore/lore-20260904T031500Z.tar.gz
set -euo pipefail
ARCHIVE="${1:?archive path}"
cd "$(dirname "$0")/.."
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$ARCHIVE"
docker compose down
mkdir -p data
rm -rf data/knowledge.git data/main data/sessions data/lore.db data/lore.db-wal data/lore.db-shm
git clone --quiet --bare "$work/knowledge.bundle" data/knowledge.git
git --git-dir=data/knowledge.git symbolic-ref HEAD refs/heads/main
cp "$work/lore.db" data/lore.db
docker compose up -d
echo "restored from $ARCHIVE"
