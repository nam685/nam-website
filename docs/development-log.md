# Development Log

## 2026-03-28 — Cyberpunk UI redesign + wheel nav

Rebuilt the entire frontend aesthetic: red/black cyberpunk palette (One True God crimson) with per-section accent colors (draws=purple, vibecodes=green, grinds=amber). Replaced the static navbar with a horizontal wheel nav where items simulate a circular wheel viewed from the side — physics-based x/scale/opacity driven by trigonometry, looping topology, 44px+ touch targets. A single `--accent` CSS variable propagates the active section's color site-wide via `document.documentElement.style.setProperty`, so the navbar border, card borders, headings, and hero all shift hue together when navigating. Used Stitch (Google's AI UI tool) for design exploration and Playwright headless Chromium for local screenshot feedback.

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
- Site live at https://nam685.de

### Pending
- Start PostgreSQL + Redis via Docker Compose
- Deploy Django backend

## 2026-03-28

### CI/CD & Deploy Pipeline
- Set up GitHub Actions: CI (lint + type-check) → Deploy (SSH to server)
- Deploy uses dedicated clone `~/nam-website-deploy` with `git fetch + reset --hard`
- Fixed SIGTERM issue: appleboy SSH action kills nohup processes on disconnect
- **Process manager: systemd** — `/etc/systemd/system/nextjs.service` with `Restart=always`
  - Passwordless sudo for `systemctl restart/start/stop nextjs` via `/etc/sudoers.d/nextjs`
  - Deploy script: `sudo systemctl restart nextjs` after build
- Node.js upgraded 18 → 22 via nvm (Next.js 16 requires >=20.9.0; NodeSource ARM64 broken)
  - Tailwind v4 ARM64 oxide bindings now work with Node 22

### Dependency Updates
- All dependabot PRs merged: Next.js 15→16, ESLint, @types/node, GitHub Actions deps
- Dependabot auto-merge workflow: `.github/workflows/dependabot-automerge.yml`
  - Auto-enables merge on dependabot PRs; triggers `@dependabot rebase` on main push

### Django Backend + PostgreSQL
- Installed Docker, started PostgreSQL 16 + Redis 7 via Docker Compose
- `TodoSection` + `TodoItem` models, data migration seeds all todo items
- `GET /api/todo/` endpoint; `/todo` page now fetches from Django server-side
- `website/models/` and `website/views/` restructured as packages
- Django served by gunicorn via systemd (`/etc/systemd/system/django.service`)
- Caddy updated: `/api/*` → Django :8000, everything else → Next.js :3000
- `ALLOWED_HOSTS` includes `nam685.de` in server `.env`
- Pyright LSP plugin installed in Claude Code for Python intelligence
