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
- **PostgreSQL + Redis** — via Docker Compose (localhost-only, not exposed to internet, `restart: unless-stopped`)

### Off-server: AoE2 recorded-game watcher

A small daemon runs on the **gaming PC** (not the server) to auto-upload Age of Empires 2
DE recorded games to the site after each match. Setup and operation:
[`scripts/AOE2_WATCHER.md`](../scripts/AOE2_WATCHER.md).

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
for klaude): `DEBUG`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `ADMIN_SECRET`, `REDIS_URL`,
`ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `ALPHA_VANTAGE_API_KEY`, `YTMUSIC_CLIENT_ID`, `YTMUSIC_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LASTFM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
`AOE2_CLAUDE_BIN`, `AOE2_COACH_MODEL`, `GEMINI_API_KEY`.

**Standalone scripts** (`scripts/audiobook_*.py`, using `NAM_ADMIN_TOKEN`) are not systemd-managed
and keep reading a local `.env` when run manually — out of scope for this migration.

**Setting up a new project from scratch** (e.g. after a server rebuild): create the project in the
Bitwarden Secrets Manager web UI, add all vars above with real values, create a machine account with
**read-only** access scoped to just that project, generate its access token, and write it to
`/etc/nam-website/bws-token` per step 3 below.

**Rotation:** storage location changed, values did not — `ADMIN_SECRET`/`SECRET_KEY`/OAuth secrets
still hold their pre-migration values and should be rotated in a follow-up pass now that the old
values have sat in a flat file (and server backups/history) for a while.

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
