# Infrastructure

## Server

- **Provider:** Hetzner Cloud
- **Public IP:** 46.224.162.194
- **Architecture:** x86_64
- **OS:** Ubuntu
- **Node.js:** v20

## Domain

- **Domain:** nam685.de (registered via Porkbun, ~$2.50/yr first year)
- **DNS:** Porkbun DNS, A record → 46.224.162.194

## Services Running

- **Caddy** — reverse proxy on ports 80/443, auto HTTPS via Let's Encrypt
- **Next.js frontend** — port 3000, systemd service (`nextjs`)
- **Django backend** — port 8000, systemd service (`django`) via gunicorn
- **Celery worker** — systemd service (`celery`), uses Redis as broker
- **PostgreSQL + Redis** — via Docker Compose (localhost-only, not exposed to internet, `restart: unless-stopped`).
  Postgres requires `scram-sha-256` for every connection, including local socket/127.0.0.1/::1 — a
  custom `infra/pg_hba.conf` (mounted via `docker-entrypoint-initdb.d`) replaces the stock image's
  default `trust` rule for those addresses. See issue #298.

### Off-server: AoE2 recorded-game watcher

A small daemon runs on the **gaming PC** (not the server) to auto-upload Age of Empires 2
DE recorded games to the site after each match. Setup and operation:
[`scripts/AOE2_WATCHER.md`](../scripts/AOE2_WATCHER.md).

## Backups

**Prerequisite:** complete [First-time Server Setup](#first-time-server-setup) below
first — these steps assume the repo is cloned, the Bitwarden bootstrap secret
(`/etc/nam-website/bws-token`) is set up, and Docker services are running.

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

3. **Install rclone and age on the server**:
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   sudo apt update && sudo apt install -y age
   rclone config  # create a remote named "b2", type "b2", paste the
                   # Application Key ID / Application Key from step 2
                   # (run this as the `nam` user, not root/sudo — the systemd
                   # service runs as `nam` and needs to see
                   # ~nam/.config/rclone/rclone.conf)
   ```
   This writes `~/.config/rclone/rclone.conf` (already `chmod 600` by
   rclone) — never commit this file. `age` is installed via apt (not
   `~/.local/bin`) so it lands on the default `PATH` that systemd services see.

4. **Create the healthchecks.io check**: sign up at healthchecks.io, create
   a check named "nam-website-backup", schedule "Every 1 day" with a few
   hours of grace, notification channel = email to nam685@proton.me. Copy
   the check's UUID (from its ping URL, `https://hc-ping.com/<uuid>`).

5. **Add to Bitwarden Secrets Manager** (project `nam-website-prod` — see
   "Secrets (Bitwarden Secrets Manager)" below), not a flat `.env` (there
   isn't one on the server anymore, per issue #296):
   - `BACKUP_AGE_PUBLIC_KEY` — public key from step 1
   - `BACKUP_B2_REMOTE` — `b2:nam-website-backup`
   - `HEALTHCHECKS_BACKUP_UUID` — check UUID from step 4

6. **Install the systemd units**:
   ```bash
   sudo cp infra/postgres-backup.service infra/postgres-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now postgres-backup.timer
   ```

7. **Run it once by hand and verify**:
   ```bash
   sudo systemctl start postgres-backup.service
   sudo systemctl is-failed postgres-backup.service   # expect: inactive (means it succeeded, not "failed")
   journalctl -u postgres-backup.service -n 50        # review the run's output
   rclone ls b2:nam-website-backup                 # should show today's db/ and media/ objects
   ```
   Check healthchecks.io shows a successful check-in.

8. **Do one test restore, on your own machine** (required — an unrestorable
   backup is worse than no backup, because it creates false confidence).
   Run this on the machine where the private age key from step 1 lives —
   **not** the server, since decrypting there would mean the private key
   touches the VPS. Assumes `docker compose up -d` is running locally (per
   `make up`) and `rclone`/`age` are installed locally too:
   ```bash
   # On your own machine (where the private age key lives) — NOT the server
   rclone cat b2:nam-website-backup/db/<date>.sql.gz.age \
     | age -d -i /path/to/nam-website-backup-key.txt \
     | gunzip > /tmp/restore-test.sql
   docker compose exec -T db psql -U postgres -c "create database restore_test"
   docker compose exec -T db psql -U postgres restore_test < /tmp/restore-test.sql
   docker compose exec -T db psql -U postgres restore_test -c "select count(*) from website_thought;"
   docker compose exec -T db psql -U postgres -c "drop database restore_test"
   ```
   This validates the DB restore path only — the media backup isn't covered
   by an automated restore test (full media restore coverage is deferred to
   the disaster-recovery runbook, issue #291 item 5).

9. **Set the B2 bucket lifecycle rule**: in the B2 bucket settings, add a
   lifecycle rule scoped to the `db/` prefix only that deletes files older
   than 30 days, so storage cost doesn't grow unbounded. Do **not** apply
   this rule bucket-wide: `media/` is an `rclone sync` mirror of the live
   media directory (not append-only dated objects like `db/`), so a flat
   30-day expiry would delete the current, still-needed copy 30 days after
   its last upload. This is bucket-side config, not repo code.

   For `media/`, enable B2 file versioning ("keep prior file versions")
   instead of an expiry rule, so files that get deleted or overwritten by
   the nightly `rclone sync` (which propagates server-side deletions) have
   recoverable history rather than a hard cutoff.

   Also add a lifecycle rule scoped to the `media-deleted/` prefix (where
   `rclone sync --backup-dir` moves files removed from `media/`) that
   expires objects after 90 days — long enough to notice and recover from
   an accidental deletion, short enough to keep that prefix from growing
   unbounded.

---

## Monitoring

Error tracking (Django + Next.js), uptime monitoring (API health +
homepage), and cron monitoring (`sync_prices`) via Sentry — all configured
as code in `infra/sentry/`, not clicked together in the dashboard.

**One-time setup:**

1. Create a Sentry account/org if you don't have one (sentry.io, free
   tier). Note the org slug and find its default team's slug under
   Settings > Teams.

2. Create a Sentry Auth Token: Settings > Auth Tokens, scoped to
   `org:read`, `project:write`, `alerts:write`.

3. From `infra/sentry/`, apply the config (from your own machine — this
   is operator-managed, not part of CI, same tier as the backup's
   `rclone`/`age` setup):
   ```bash
   cd infra/sentry
   export SENTRY_AUTH_TOKEN=<token from step 2>
   tofu init
   tofu apply -var="sentry_org=personal-0ob" -var="sentry_team=personal"
   ```

4. Retrieve the two DSNs the apply just produced:
   ```bash
   tofu output -raw backend_dsn
   tofu output -raw frontend_dsn
   ```

5. Add the backend DSN to Bitwarden Secrets Manager's `nam-website-prod`
   project as `SENTRY_DSN` (same place every other backend secret lives —
   see "Secrets (Bitwarden Secrets Manager)" below).

6. Add the frontend DSN as a GitHub Actions repo secret named
   `SENTRY_DSN_FRONTEND` (repo Settings > Secrets and variables > Actions)
   — `deploy.yml` bakes it into the Next.js build.

7. In your Sentry account's own notification settings (not part of the
   Terraform config — this is per-user, not per-org), confirm the
   registered email is nam685@proton.me, or that your notification
   preferences route "Issue Owners"/"Active Members" alerts there. The
   alert rules route to org members via Sentry's own membership model, not
   a raw email address.

8. Redeploy (or manually restart `django`/`celery` and re-run the frontend
   build) so both apps pick up their DSNs.

9. Verify: trigger a real error (e.g. temporarily hit a broken endpoint)
   and confirm it shows up in the relevant Sentry project; check that the
   two uptime monitors and the `sync-prices` cron monitor show up in
   Sentry as "OK" after their next check.

**Changing the config later:** edit `infra/sentry/*.tf` and re-run
`tofu apply` with the same `-var` flags from step 3 — OpenTofu diffs
against local state and applies only what changed.

---

## Secrets (Bitwarden Secrets Manager)

Prod secrets — for `django`, `celery`, `sync-prices`, and `klaude-worker` (see
[`docs/server-setup-klaude.md`](server-setup-klaude.md)) — live in a Bitwarden **Secrets Manager**
project (`nam-website-prod`), not a flat `.env`. This is a distinct product/API from the personal
Bitwarden vault. Local/dev is unaffected — `docker compose`/`make up` still use a plain `.env`.

Every unit's `ExecStart` is wrapped with `bws run --project-id <project-id> -- <command>`, which
injects the project's secrets as env vars for that one process only. The single remaining flat-file
secret is `/etc/nam-website/bws-token` (`BWS_ACCESS_TOKEN=...`, `chmod 600`, owned `nam`, never in
git) — a read-only machine-account token scoped to just this one project. Functionally equivalent to
a 1Password Service Account token: one bootstrap credential everything else derives from.

**Current secrets in the project** (mirrors what used to be in prod `.env`, plus `GEMINI_API_KEY`
for klaude and the `postgres-backup` trio below): `DEBUG`, `SECRET_KEY`, `POSTGRES_PASSWORD`,
`DATABASE_URL`, `ADMIN_SECRET`, `REDIS_URL`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
`CSRF_TRUSTED_ORIGINS`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALPHA_VANTAGE_API_KEY`,
`YTMUSIC_CLIENT_ID`, `YTMUSIC_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`LASTFM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AOE2_CLAUDE_BIN`, `AOE2_COACH_MODEL`,
`GEMINI_API_KEY`, `BACKUP_AGE_PUBLIC_KEY`, `BACKUP_B2_REMOTE`, `HEALTHCHECKS_BACKUP_UUID`.

**Standalone scripts** (`scripts/audiobook_*.py`, using `NAM_ADMIN_TOKEN`) are not systemd-managed
and keep reading a local `.env` when run manually — out of scope for this migration.

**Setting up a new project from scratch** (e.g. after a server rebuild): create the project in the
Bitwarden Secrets Manager web UI, add all vars above with real values, create a machine account with
**read-only** access scoped to just that project, generate its access token, and write it to
`/etc/nam-website/bws-token` per step 3 below.

**Rotation:** `ADMIN_SECRET` and `SECRET_KEY` were rotated 2026-07-26 via the Bitwarden web UI.
OAuth client secrets and other free-tier third-party keys still hold their pre-migration values
(deliberately deferred — see backlog/memory for the cost/benefit reasoning).

---

## First-time Server Setup

Run these steps once on a new server. The deploy CI only restarts services — it does not install dependencies.

### 1. Install system tools

```bash
# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc

# pnpm (Node package manager)
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc

# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
```

### 2. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy -y
```

### 3. Clone repo and install bws

```bash
git clone https://github.com/nam685/nam-website.git ~/nam-website-deploy
cd ~/nam-website-deploy
```

Prod secrets are stored in **Bitwarden Secrets Manager** (project `nam-website-prod`), not a flat `.env` — see "Secrets (Bitwarden Secrets Manager)" below for the full list of vars and how to populate a new project. Install the `bws` CLI:

```bash
cd /tmp
curl -sL -o bws.zip https://github.com/bitwarden/sdk-sm/releases/latest/download/bws-x86_64-unknown-linux-gnu-<version>.zip
unzip bws.zip -d bws-extracted
sudo install -m 755 bws-extracted/bws /usr/local/bin/bws
rm -rf bws.zip bws-extracted
```

Create the one bootstrap secret — a read-only machine-account access token scoped to the `nam-website-prod` project only:

```bash
sudo mkdir -p /etc/nam-website
echo 'BWS_ACCESS_TOKEN=<machine-account-token>' | sudo tee /etc/nam-website/bws-token
sudo chown nam:nam /etc/nam-website/bws-token
sudo chmod 600 /etc/nam-website/bws-token
```

### 4. Start Docker services (PostgreSQL + Redis)

```bash
docker compose up -d
```

### 5. Run initial migration

```bash
uv sync
set -a; source /etc/nam-website/bws-token; set +a
bws run --project-id <project-id> -- uv run python manage.py migrate
```

### 6. Install systemd services

Each unit's `ExecStart` is prefixed with `bws run --project-id <project-id> -- ...` and reads `EnvironmentFile=/etc/nam-website/bws-token` (see step 3) instead of a flat `.env`. `nextjs.service` needs neither — the frontend reads no secret env vars.

```bash
sudo cp infra/django.service /etc/systemd/system/django.service
sudo cp infra/nextjs.service /etc/systemd/system/nextjs.service
sudo cp infra/celery.service /etc/systemd/system/celery.service
sudo cp infra/sync-prices.service /etc/systemd/system/sync-prices.service
sudo cp infra/sync-prices.timer /etc/systemd/system/sync-prices.timer
sudo systemctl daemon-reload
sudo systemctl enable django nextjs celery sync-prices.timer
sudo systemctl start django nextjs celery sync-prices.timer
```

### 7. Configure Caddy

```bash
sudo cp infra/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## GitHub Actions Deploy SSH Key Setup

The `DEPLOY_SSH_KEY` secret is **not** a GitHub Deploy Key — it's a dedicated SSH key that allows GitHub Actions to SSH into the server.

**One-time setup:**

```bash
# On the server — generate a dedicated key for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions -N ""

# Authorize it to log in as nam
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Print the private key — copy this into GitHub Secret DEPLOY_SSH_KEY
cat ~/.ssh/github_actions
```

Then in GitHub → repo → Settings → Secrets → Actions:
- `DEPLOY_HOST` = `46.224.162.194`
- `DEPLOY_SSH_KEY` = the private key printed above (entire content including `-----BEGIN...-----END-----`)

---

## Branch Protection (GitHub)

Set in GitHub → repo → Settings → Branches → Add rule for `main`:

- [x] Require a pull request before merging
- [x] Require status checks to pass (`build` from CI workflow)
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings

Merge settings (repo → Settings → General):
- [x] Allow squash merging only (disable merge commits and rebase)
- [x] Automatically delete head branches

---

## Server-only media assets

Some media is served from the deploy media root (`/home/nam/nam-website-deploy/media/`, exposed at `/media/*` by Caddy) but is **not** stored in git — it's uploaded out-of-band.

- **Homepage profile photos** (`/media/profile/profile-1..5.webp`): the rotating circular portrait on the landing page. Produced locally from source images with ImageMagick (`-auto-orient -resize 700x -gravity North -crop 700x700+0+220`, webp q82) and uploaded with `scp media/profile/*.webp hetzner:/home/nam/nam-website-deploy/media/profile/`. To change the photos, regenerate and re-scp; the frontend just expects `profile-1..5.webp` to exist.

---

## Firewall (ufw)

- SSH (22), HTTP (80), HTTPS (443), Mosh (60000-61000/udp)
- PostgreSQL (5432) and Redis (6379) are **not** open — bound to 127.0.0.1 only

## Hetzner Features Available

### DNS Hosting (Free)
- Hetzner DNS Console at dns.hetzner.com
- Supports A, AAAA, CNAME, MX, TXT, SRV records
- Free for Hetzner customers — use it even if domain is registered elsewhere

### Load Balancers (~5.49 EUR/mo)
- HTTP/HTTPS/TCP support, health checks, built-in Let's Encrypt

### Networking
- **Private Networks** — free, connect servers in same project
- **Floating IPs** — static IPs reassignable between servers
- **Firewalls** — free cloud-level firewalls
