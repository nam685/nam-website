# Infrastructure

## Server

- **Provider:** Hetzner Cloud
- **Public IP:** (update after new server provisioned)
- **Architecture:** aarch64 (ARM64)
- **OS:** Linux (Ubuntu)
- **Node.js:** v20

## Domain

- **Domain:** nam685.de (registered via Porkbun, ~$2.50/yr first year)
- **DNS:** Porkbun DNS, A record → (update to new server IP)

## Services Running

- **Caddy** — reverse proxy on ports 80/443, auto HTTPS via Let's Encrypt
- **Next.js frontend** — port 3000, systemd service (`nextjs`)
- **Django backend** — port 8000, systemd service (`django`) via gunicorn
- **PostgreSQL + Redis** — via Docker Compose

## First-time Server Setup

After provisioning a new server, run these steps once (deploy CI only restarts services):

```bash
# 1. Copy systemd services
sudo cp infra/django.service /etc/systemd/system/django.service
sudo cp infra/nextjs.service /etc/systemd/system/nextjs.service
sudo systemctl daemon-reload
sudo systemctl enable django nextjs

# 2. Copy Caddyfile
sudo cp infra/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 3. Create .env at deploy path
cp .env.example ~/nam-website-deploy/.env
# Edit with real SECRET_KEY, ADMIN_SECRET, DATABASE_URL, etc.

# 4. Start Docker services (PostgreSQL + Redis)
docker compose up -d

# 5. Update GitHub Secret DEPLOY_HOST to new server IP
```

## Firewall (ufw)

- SSH (22), HTTP (80), HTTPS (443), Mosh (60000-61000/udp)
- No Hetzner cloud firewall configured

## Hetzner Features Available

### DNS Hosting (Free)
- Hetzner DNS Console at dns.hetzner.com
- Supports A, AAAA, CNAME, MX, TXT, SRV records
- Free for Hetzner customers — use it even if domain is registered elsewhere

### Load Balancers (~5.49 EUR/mo)
- HTTP/HTTPS/TCP support
- Health checks, sticky sessions
- Built-in Let's Encrypt integration

### Networking
- **Private Networks** — free, connect servers in same project
- **Floating IPs** — static IPs reassignable between servers
- **Firewalls** — free cloud-level firewalls
- **Placement Groups** — control physical host distribution

### Domain Registration
- Available through Hetzner Robot panel
- Limited TLDs: .de, .com, .net, .org, .info, .eu, .at, .ch
- Not competitive on price — better to use a dedicated registrar
