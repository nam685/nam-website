#!/usr/bin/env bash
set -euo pipefail

# Nightly backup: Postgres dump + media, encrypted, uploaded offsite to
# Backblaze B2, with a healthchecks.io ping as a dead-man's-switch.
# Run via infra/postgres-backup.timer on the server. See
# docs/infrastructure.md "Backups" section for one-time setup.

: "${POSTGRES_DB:?POSTGRES_DB not set}"
: "${POSTGRES_USER:?POSTGRES_USER not set}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY not set}"
: "${BACKUP_B2_REMOTE:?BACKUP_B2_REMOTE not set}"
: "${HEALTHCHECKS_BACKUP_UUID:?HEALTHCHECKS_BACKUP_UUID not set}"

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%F)"
DUMP_PATH="/tmp/nam-website-db-${STAMP}.sql.gz.age"

cd "$WORKDIR"

echo "==> Dumping Postgres ($POSTGRES_DB)"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip \
  | age -r "$BACKUP_AGE_PUBLIC_KEY" \
  > "$DUMP_PATH"

echo "==> Uploading DB dump to ${BACKUP_B2_REMOTE}/db/${STAMP}.sql.gz.age"
rclone rcat "${BACKUP_B2_REMOTE}/db/${STAMP}.sql.gz.age" < "$DUMP_PATH"
rm -f "$DUMP_PATH"
