# Infrastructure

## Server

- **Provider:** Hetzner Cloud
- **Public IP:** 46.224.162.194
- **Architecture:** aarch64 (ARM64)
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

### 3. Clone repo and create .env

```bash
git clone https://github.com/nam685/nam-website.git ~/nam-website-deploy
cd ~/nam-website-deploy
cp .env.example .env
nano .env   # set SECRET_KEY, POSTGRES_PASSWORD, ADMIN_SECRET (use python3 secrets generator)
```

### 4. Start Docker services (PostgreSQL + Redis)

```bash
docker compose up -d
```

### 5. Run initial migration

```bash
uv sync
uv run python manage.py migrate
```

### 6. Install systemd services

```bash
sudo cp infra/django.service /etc/systemd/system/django.service
sudo cp infra/nextjs.service /etc/systemd/system/nextjs.service
sudo cp infra/celery.service /etc/systemd/system/celery.service
sudo systemctl daemon-reload
sudo systemctl enable django nextjs celery
sudo systemctl start django nextjs celery
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
