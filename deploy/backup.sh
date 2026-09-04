#!/usr/bin/env bash
# Nightly backup of the orchestrator's state: the bare knowledge repository and the SQLite
# database, taken consistently while the service runs, archived locally, then copied off the
# machine. Configuration in /etc/lore/backup.env:
#   LORE_DATA_DIR       where data/ lives (default /srv/lore/data)
#   LORE_BACKUP_DIR     local archive directory (default /var/backups/lore)
#   LORE_BACKUP_KEEP    how many local archives to keep (default 14)
#   LORE_BACKUP_TARGET  rsync destination, e.g. u123456@u123456.your-storagebox.de:lore-backups (optional)
#   LORE_MIRROR_REMOTE  git remote to mirror the knowledge repo to, e.g. a private GitHub repo (optional)
set -euo pipefail
[ -f /etc/lore/backup.env ] && . /etc/lore/backup.env
DATA="${LORE_DATA_DIR:-/srv/lore/data}"
OUT="${LORE_BACKUP_DIR:-/var/backups/lore}"
KEEP="${LORE_BACKUP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT"

# SQLite: the online backup API gives a consistent copy even with the service writing.
sqlite3 "$DATA/lore.db" ".backup '$work/lore.db'"
# Git: a bundle is a single-file, consistent snapshot of every ref; restore with `git clone lore.bundle`.
git --git-dir="$DATA/knowledge.git" bundle create "$work/knowledge.bundle" --all
cp "$DATA/knowledge.git/hooks/pre-receive" "$DATA/knowledge.git/hooks/post-receive" "$work/" 2>/dev/null || true

archive="$OUT/lore-$stamp.tar.gz"
tar -C "$work" -czf "$archive" .
echo "wrote $archive ($(du -h "$archive" | cut -f1))"

# Rotate local copies.
ls -1t "$OUT"/lore-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

if [ -n "${LORE_BACKUP_TARGET:-}" ]; then
  rsync -az --delete-after -e "ssh -o StrictHostKeyChecking=accept-new" "$OUT"/ "$LORE_BACKUP_TARGET"/
  echo "synced to $LORE_BACKUP_TARGET"
fi
if [ -n "${LORE_MIRROR_REMOTE:-}" ]; then
  git --git-dir="$DATA/knowledge.git" push --mirror --quiet "$LORE_MIRROR_REMOTE"
  echo "mirrored knowledge repo to $LORE_MIRROR_REMOTE"
fi
