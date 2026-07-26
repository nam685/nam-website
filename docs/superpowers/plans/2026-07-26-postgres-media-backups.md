# Postgres + Media Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nightly, encrypted, offsite backup of the Postgres database and media directory, with dead-man's-switch monitoring so a missed or failed backup alerts by email.

**Architecture:** A single bash script (`infra/backup.sh`) run nightly by a systemd oneshot service + timer (same pattern as `infra/sync-prices.service`/`.timer`). The script dumps Postgres via `docker compose exec`, encrypts with `age`, syncs both the dump and the media directory to a Backblaze B2 bucket via `rclone`, then pings healthchecks.io only if every prior step succeeded.

**Tech Stack:** bash, `age` (encryption), `rclone` (B2 upload), `docker compose exec` (Postgres access), systemd (scheduling), healthchecks.io (dead-man's-switch), Backblaze B2 (offsite storage).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-postgres-media-backups-design.md`
- Backups must be encrypted before leaving the server (age, public-key only — private key never touches the server).
- Backup destination must be a different provider than Hetzner (Backblaze B2).
- The script must fail loudly (non-zero exit, `set -euo pipefail`) and must NOT ping healthchecks.io on any failure — a missing ping is the alert signal.
- New secrets this work introduces (`HEALTHCHECKS_BACKUP_UUID`, B2/rclone credentials) go wherever issue #296's Bitwarden migration currently has secrets landing — check `.env` vs Bitwarden Secrets Manager state before wiring the systemd `EnvironmentFile=` line. If #296 isn't finished yet, use `.env` + `EnvironmentFile=` (existing pattern, e.g. `infra/sync-prices.service`) and leave a one-line note in `docs/infrastructure.md` to migrate later.
- No pytest/vitest coverage is expected for this work — `age`, `rclone`, and `docker` are not available in the dev/CI sandbox (verified: none of `age`, `rclone`, `docker`, `shellcheck` are on PATH here). Verification is `bash -n` syntax checking plus manual code review; full functional verification (including the one required test restore) happens on the real server per Task 4, after deploy.
- Existing repo conventions to follow: systemd units live in `infra/`, `WorkingDirectory=/home/nam/nam-website-deploy`, `EnvironmentFile=/home/nam/nam-website-deploy/.env`, `User=nam` (see `infra/sync-prices.service`). Postgres service name in `docker-compose.yml` is `db`; `POSTGRES_DB` defaults to `nam_website`, `POSTGRES_USER` defaults to `postgres`. Django `MEDIA_ROOT` is `BASE_DIR / "media"`, i.e. `/home/nam/nam-website-deploy/media` on the server.

---

### Task 1: `infra/backup.sh` — Postgres dump, encrypt

**Files:**
- Create: `infra/backup.sh`
- Modify: `.env.example` — add new vars section

**Interfaces:**
- Produces: `infra/backup.sh`, a standalone script with no arguments. Reads config from environment variables: `POSTGRES_DB`, `POSTGRES_USER` (both already defined in `.env`/`.env.example`), plus new vars `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_B2_REMOTE` (rclone remote:path prefix, e.g. `b2:nam-website-backup`), `HEALTHCHECKS_BACKUP_UUID`. Exits non-zero on any failure (`set -euo pipefail`), exits 0 and pings healthchecks.io only on full success. Later tasks append steps to this same script.

- [ ] **Step 1: Write `infra/backup.sh` with the dump + encrypt steps**

```bash
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
```

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n infra/backup.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Make it executable**

Run: `chmod +x infra/backup.sh`

- [ ] **Step 4: Add new env vars to `.env.example`**

Add this block after the existing `AOE2_*` section at the end of `.env.example`:

```
# Backups (infra/backup.sh, see docs/infrastructure.md "Backups")
# BACKUP_AGE_PUBLIC_KEY=age1...   # public half of the age keypair; private key stays off-server
# BACKUP_B2_REMOTE=b2:nam-website-backup  # rclone remote:path prefix (requires rclone.conf on server)
# HEALTHCHECKS_BACKUP_UUID=       # healthchecks.io check UUID for the dead-man's-switch ping
```

- [ ] **Step 5: Commit**

```bash
git add infra/backup.sh .env.example
git commit -m "feat(infra): add Postgres dump+encrypt step to backup script"
```

---

### Task 2: `infra/backup.sh` — media sync + healthchecks ping

**Files:**
- Modify: `infra/backup.sh` (append to the script from Task 1)

**Interfaces:**
- Consumes: `infra/backup.sh` from Task 1 — appends steps after the DB upload, same env vars already validated at the top of the script.
- Produces: completed `infra/backup.sh`, the final version run in production.

- [ ] **Step 1: Append the media sync step**

Add after the DB upload block from Task 1:

```bash
echo "==> Syncing media directory to ${BACKUP_B2_REMOTE}/media/"
rclone sync "${WORKDIR}/media" "${BACKUP_B2_REMOTE}/media/"
```

- [ ] **Step 2: Append the healthchecks.io success ping**

Add as the last lines of the script:

```bash
echo "==> Backup complete, pinging healthchecks.io"
curl -fsS -m 10 --retry 3 "https://hc-ping.com/${HEALTHCHECKS_BACKUP_UUID}" -o /dev/null
```

- [ ] **Step 3: Syntax-check the full script**

Run: `bash -n infra/backup.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Review the full script end-to-end**

Read the complete `infra/backup.sh` and confirm: `set -euo pipefail` is on line 2, every external command (`docker`, `age`, `rclone`, `curl`) is on a path that aborts the script on failure, and the healthchecks.io ping is the last line (nothing after it that could silently fail post-ping).

- [ ] **Step 5: Commit**

```bash
git add infra/backup.sh
git commit -m "feat(infra): add media sync + healthchecks.io ping to backup script"
```

---

### Task 3: systemd service + timer

**Files:**
- Create: `infra/postgres-backup.service`
- Create: `infra/postgres-backup.timer`

**Interfaces:**
- Consumes: `infra/backup.sh` from Tasks 1-2 (as `ExecStart`).
- Produces: unit files installed by the server setup steps in Task 4.

- [ ] **Step 1: Write `infra/postgres-backup.service`**

```ini
[Unit]
Description=Postgres + media backup (encrypted, offsite)

[Service]
Type=oneshot
User=nam
WorkingDirectory=/home/nam/nam-website-deploy
EnvironmentFile=/home/nam/nam-website-deploy/.env
ExecStart=/home/nam/nam-website-deploy/infra/backup.sh
```

- [ ] **Step 2: Write `infra/postgres-backup.timer`**

```ini
[Unit]
Description=Nightly Postgres + media backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Validate unit file syntax**

Run: `systemd-analyze verify infra/postgres-backup.service infra/postgres-backup.timer 2>&1 || true`
Expected: either clean validation, or (if `systemd-analyze` isn't available in this sandbox) no crash from the command itself — note in the task result whether the tool was available. This is a best-effort check; the units are installed and started for real on the server in Task 4.

- [ ] **Step 4: Commit**

```bash
git add infra/postgres-backup.service infra/postgres-backup.timer
git commit -m "feat(infra): add systemd service+timer for nightly backup"
```

---

### Task 4: Documentation — `docs/infrastructure.md` "Backups" section

**Files:**
- Modify: `docs/infrastructure.md` — add a new `## Backups` section (place it after the existing "Services Running" section, before "First-time Server Setup", matching the doc's existing top-to-bottom structure of overview-then-setup)

**Interfaces:**
- Consumes: env var names and file paths from Tasks 1-3 (`infra/backup.sh`, `infra/postgres-backup.service`/`.timer`, `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_B2_REMOTE`, `HEALTHCHECKS_BACKUP_UUID`).
- Produces: the operational runbook a future session (including the item-5 DR runbook work) will link to.

- [ ] **Step 1: Add the Backups section**

Insert into `docs/infrastructure.md`:

```markdown
## Backups

Nightly encrypted backup of the Postgres database and media directory,
uploaded offsite to Backblaze B2 (a different provider than Hetzner), with
a healthchecks.io dead-man's-switch: if the nightly job doesn't run or
fails partway, healthchecks.io emails nam685@proton.me because the
expected daily ping didn't arrive.

**One-time setup on the server:**

1. **Generate the age keypair** (do this on your own machine, NOT the
   server — the private key must never touch the VPS):
   ```bash
   age-keygen -o nam-website-backup-key.txt
   # prints "Public key: age1..." — copy that into BACKUP_AGE_PUBLIC_KEY below
   ```
   Store `nam-website-backup-key.txt` somewhere durable and private (password
   manager, offline drive). This is the ONLY way to decrypt backups — losing
   it makes all backups permanently unreadable. Full restore procedure is
   documented separately once the disaster-recovery runbook (issue #291
   item 5) lands.

2. **Create the B2 bucket**: sign up at backblaze.com, create a bucket named
   `nam-website-backup` (private), create an Application Key scoped to that
   bucket.

3. **Install and configure rclone on the server**:
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   rclone config  # create a remote named "b2", type "b2", paste the
                   # Application Key ID / Application Key from step 2
   ```
   This writes `~/.config/rclone/rclone.conf` (already `chmod 600` by
   rclone) — never commit this file.

4. **Create the healthchecks.io check**: sign up at healthchecks.io, create
   a check named "nam-website-backup", schedule "Every 1 day" with a few
   hours of grace, notification channel = email to nam685@proton.me. Copy
   the check's UUID (from its ping URL, `https://hc-ping.com/<uuid>`).

5. **Add to `.env`** on the server:
   ```
   BACKUP_AGE_PUBLIC_KEY=age1...       # from step 1
   BACKUP_B2_REMOTE=b2:nam-website-backup
   HEALTHCHECKS_BACKUP_UUID=<uuid>     # from step 4
   ```
   (If issue #296's Bitwarden Secrets Manager migration has landed by the
   time you set this up, add these there instead, following whatever
   pattern #296 established for the other secrets.)

6. **Install the systemd units**:
   ```bash
   sudo cp infra/postgres-backup.service infra/postgres-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now postgres-backup.timer
   ```

7. **Run it once by hand and verify**:
   ```bash
   sudo systemctl start postgres-backup.service
   sudo systemctl status postgres-backup.service   # should exit 0
   rclone ls b2:nam-website-backup                 # should show today's db/ and media/ objects
   ```
   Check healthchecks.io shows a successful check-in.

8. **Do one test restore** (required — an unrestorable backup is worse than
   no backup, because it creates false confidence):
   ```bash
   rclone cat b2:nam-website-backup/db/<date>.sql.gz.age \
     | age -d -i /path/to/nam-website-backup-key.txt \
     | gunzip > /tmp/restore-test.sql
   createdb restore_test
   psql restore_test < /tmp/restore-test.sql
   psql restore_test -c "select count(*) from website_thought;"  # sanity check
   dropdb restore_test
   ```

9. **Set the B2 bucket lifecycle rule**: in the B2 bucket settings, add a
   lifecycle rule to delete files older than 30 days, so storage cost
   doesn't grow unbounded. This is bucket-side config, not repo code.
```

- [ ] **Step 2: Commit**

```bash
git add docs/infrastructure.md
git commit -m "docs(infra): document nightly backup setup and restore test"
```

---

## Self-Review Notes

- **Spec coverage:** DB dump (Task 1), encryption before leaving server (Task 1), media sync (Task 2), offsite B2 upload (Tasks 1-2), dead-man's-switch ping only on success (Task 2), systemd nightly schedule matching `sync-prices` pattern (Task 3), B2 lifecycle retention documented (Task 4 step 9), private-key-off-server custody note (Task 4 step 1), one-time test restore (Task 4 step 8), Bitwarden/#296 coordination note (Global Constraints + Task 4 step 5). All spec sections have a task.
- **No placeholders:** all steps contain literal script/config content, no TBD.
- **Type/name consistency:** `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_B2_REMOTE`, `HEALTHCHECKS_BACKUP_UUID` are the same three names across Task 1 (defined), Task 2 (used), Task 3 (`EnvironmentFile`), Task 4 (documented). `infra/backup.sh` is the same path in Tasks 1, 2, 3. Postgres service name `db`, `POSTGRES_DB`/`POSTGRES_USER` match `docker-compose.yml`.
