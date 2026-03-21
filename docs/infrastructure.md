# Infrastructure

## Server

- **Provider:** Hetzner Cloud
- **Public IP:** 204.168.159.7
- **Architecture:** aarch64 (ARM64)
- **OS:** Linux (Ubuntu)
- **Node.js:** v18.19.1

## Domain

- **Domain:** nam685.de (registered via Porkbun, ~$2.50/yr first year)
- **DNS:** Porkbun DNS, A record → 204.168.159.7

## Services Running

- **Caddy** — reverse proxy on ports 80/443, auto HTTPS via Let's Encrypt
- **Next.js frontend** — port 3000, running in zellij session `website`
- **Django backend** — not yet deployed
- **PostgreSQL + Redis** — via Docker Compose (not yet started)

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
