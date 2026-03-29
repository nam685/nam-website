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
- **PostgreSQL + Redis** — via Docker Compose (localhost-only, not exposed to internet)

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
sudo systemctl daemon-reload
sudo systemctl enable django nextjs
sudo systemctl start django nextjs
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
