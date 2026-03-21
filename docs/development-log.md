# Development Log

## 2026-03-21

### Initial Setup
- Django + Next.js project scaffolded
- Hetzner ARM64 server at 204.168.159.7
- Installed pnpm via install script
- Tailwind v4 oxide bindings not available for linux-arm64 on Node 18
  - Workaround: using inline styles + vanilla CSS instead of Tailwind
  - Fix later: upgrade to Node 20+ or wait for ARM64 oxide support

### Image Gallery Page
- Created 2-tab page with drawings (underwater scene, house with dog)
- Images stored in `frontend/public/images/`
- Built successfully with `pnpm exec next build`

### Domain & Hosting
- Bought nam685.de on Porkbun ($2.50/yr)
- Deleted default Porkbun parking records (ALIAS/CNAME to pixie.porkbun.com)
- Added A record → 204.168.159.7
- Installed Caddy, configured reverse proxy to localhost:3000
- Opened ports 80/443 in ufw (were blocked, causing Let's Encrypt timeout)
- Next.js running in zellij session `website` (`zellij attach website` to debug)
- Site live at https://nam685.de

### Pending
- GitHub CI/CD for auto-deploy
- Start PostgreSQL + Redis via Docker Compose
- Deploy Django backend
