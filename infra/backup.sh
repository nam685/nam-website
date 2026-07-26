#!/usr/bin/env bash
set -euo pipefail

# Nightly backup: Postgres dump + media, encrypted, uploaded offsite to
# Backblaze B2, with a healthchecks.io ping as a dead-man's-switch.
# Run via infra/postgres-backup.timer on the server. See
# docs/infrastructure.md "Backups" section for one-time setup.

POSTGRES_DB="${POSTGRES_DB:-nam_website}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY not set}"
: "${BACKUP_B2_REMOTE:?BACKUP_B2_REMOTE not set}"
: "${HEALTHCHECKS_BACKUP_UUID:?HEALTHCHECKS_BACKUP_UUID not set}"

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%F)"
DUMP_PATH="/tmp/nam-website-db-${STAMP}.sql.gz.age"
trap 'rm -f "$DUMP_PATH"' EXIT

cd "$WORKDIR"

echo "==> Dumping Postgres ($POSTGRES_DB)"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip \
  | age -r "$BACKUP_AGE_PUBLIC_KEY" \
  > "$DUMP_PATH"

echo "==> Uploading DB dump to ${BACKUP_B2_REMOTE}/db/${STAMP}.sql.gz.age"
rclone copyto "$DUMP_PATH" "${BACKUP_B2_REMOTE}/db/${STAMP}.sql.gz.age"

echo "==> Syncing media directory to ${BACKUP_B2_REMOTE}/media/"
mkdir -p "${WORKDIR}/media"
rclone sync "${WORKDIR}/media" "${BACKUP_B2_REMOTE}/media/" --backup-dir "${BACKUP_B2_REMOTE}/media-deleted/${STAMP}"

echo "==> Backup complete, pinging healthchecks.io"
curl -fsS -m 10 --retry 3 "https://hc-ping.com/${HEALTHCHECKS_BACKUP_UUID}" -o /dev/null
