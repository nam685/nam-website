# Postgres + media backups with dead-man's-switch monitoring

Source: [issue #291](https://github.com/nam685/nam-website/issues/291), item 1 (P0).

## Problem

There is no backup mechanism anywhere in the repo. The `postgres_data` Docker
volume on the single Hetzner VPS is the only copy of all app data (thoughts,
listens history, AoE2 matches, bets, slops sessions). Media
(`/media/audiobooks`, profile photos) also has no second copy. Losing the VPS
means losing everything.

## Architecture

A nightly systemd timer (mirroring the existing `sync-prices.timer` pattern)
runs `infra/backup.sh` on the VPS. The script dumps Postgres, encrypts it,
syncs media, uploads both to Backblaze B2 (a different provider than
Hetzner), and pings healthchecks.io only on full success — so a missing or
failed run alerts by *absence* of a ping within its grace window, not by
needing explicit failure-detection logic.

## Components

- **`infra/backup.sh`** — the job:
  1. `docker compose exec -T postgres pg_dump -U <user> <db>` → `gzip`
  2. `age -r <pubkey>` encrypt the gzipped dump
  3. `rclone rcat b2:nam-website-backup/db/$(date +%F).sql.gz.age`
  4. `rclone sync` the media directory to `b2:nam-website-backup/media/`
  5. `curl -fsS https://hc-ping.com/$HEALTHCHECKS_BACKUP_UUID`

  `set -euo pipefail` throughout, so any step failing aborts the script
  before the success ping in step 5.

- **`infra/postgres-backup.service` + `.timer`** — oneshot systemd unit,
  nightly (e.g. 03:00 server time), `EnvironmentFile=` pulling
  `HEALTHCHECKS_BACKUP_UUID` (and B2/rclone credentials, if not sourced from
  `rclone.conf`) from wherever the server's secrets currently live.

- **age keypair** — public key hardcoded in `infra/backup.sh` (public info,
  safe to commit). Private key generated once and kept **off the server**
  (user's machine / password manager) — a compromised VPS then cannot
  decrypt existing backups. Full restore procedure (including exact private
  key custody) is documented as part of issue #291 item 5 (DR runbook); this
  spec only covers generating the keypair and wiring the public half into
  the backup script.

- **rclone config** — B2 application key, configured server-side only via
  `~/.config/rclone/rclone.conf`, `chmod 600`, not committed. Setup steps
  added to `docs/infrastructure.md`'s first-time-setup section.

- **B2 lifecycle rule** — configured in the B2 bucket UI/CLI, not repo code:
  expire objects after 30 days. Documented in `docs/infrastructure.md`, not
  automated — matches the elluminate-infra principle that retention config
  should live somewhere `destroy` can never touch, trivially satisfied here
  since it isn't in this repo at all.

- **healthchecks.io** — one check ("nam-website-backup"), daily schedule
  with a few hours of grace, email alert to nam685@proton.me on missed or
  failed ping.

## Secrets note (coordinate with issue #296)

Production secrets are mid-migration from flat `.env` to Bitwarden Secrets
Manager in a separate, ongoing session (issue #296). This backup job
introduces new secrets (`HEALTHCHECKS_BACKUP_UUID`, B2/rclone credentials).
Implementation should add these wherever `#296` currently has secrets
landing (still `.env` via `EnvironmentFile=`, or already Bitwarden-backed by
the time this is built) rather than assuming a flat `.env` file is
permanent. Check the state of #296 before wiring this up.

## Error handling

Failure anywhere in the pipeline (docker exec, pg_dump, age, rclone) aborts
the script before the ping — healthchecks.io flags it as missed within its
grace window. No separate failure-path code is needed; `set -euo pipefail`
does the work.

## Testing

This is ops tooling, not application logic covered by pytest/vitest.
Verification is manual:

1. Run `infra/backup.sh` once by hand on the server.
2. Confirm the encrypted object lands in the B2 bucket.
3. Confirm the healthchecks.io ping registers as a successful check-in.
4. Do **one real test restore**: decrypt (`age -d`) → `gunzip` → `psql`
   into a scratch database, and confirm the data is intact. This proves the
   backup is actually restorable, not just that a file landed in a bucket.

## Documentation

`docs/infrastructure.md` gets a new "Backups" section covering: B2 bucket
creation, rclone config setup, age keygen + public key placement, private
key custody note, healthchecks.io check creation, and the systemd
service/timer install steps (same pattern as the existing `sync-prices`
entry).

## Out of scope (deferred to later #291 items)

- Full disaster-recovery runbook (item 5).
- Uptime/error monitoring beyond this one healthchecks.io check (item 2).
- Deploy pipeline changes (items 3-4).
