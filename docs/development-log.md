# Development Log

## 2026-07-05 — Listens full-graph: fast zoomed-out render, admin button, merged Sync/Auth, cached endpoint

The admin diagnostic full-graph page at `/listens/graph` (~3000 nodes) lagged badly when zoomed out because it ran per-node `shadowBlur` and drew every edge each frame. Added an automatic **minimal render path** (flat component-colored dots, no glow/rings/labels) plus **edge culling** below a zoom threshold, driven by a new pure `shouldMinimal(scale, threshold)` predicate; full detail returns on zoom-in. Also: an admin-only **`⊹ FULL GRAPH`** button on `/listens` linking to it; the separate Sync and Auth buttons **merged into one reactive button** (SYNC → flips to AUTH on `auth_expired`, back to SYNC after re-auth); the patch view now **centers on the seed** with legible labels on each shuffle instead of zoom-to-fit; and the full-graph endpoint moved to bare **`/api/listens/graph/`**, served from a Redis cache **warmed at the tail of each graph rebuild** (the snapshot runs connected-components / articulation / bridge analysis, so it's worth caching), lazily recomputed on a miss.

## 2026-07-05 — Listens sync UX: no-timeout rebuild, live refresh, graph follows player

Follow-ups after the sync fix shipped. (1) Reauth now derives the SAPISIDHASH from the cookie itself, so any pasted YTM POST works even when it has no Authorization header (previously rejected as "oauth JSON provided"). (2) Removed the inline graph-rebuild fallback: the Last.fm pass takes minutes and would blow gunicorn's 120s timeout, turning a successful sync into a "quiet failure" — if Celery is unavailable we now skip the rebuild (tracks are already saved) instead of blocking the request. (3) After a sync the stats refresh immediately and the graph re-polls while the async rebuild runs, so new listens appear without a manual page reload. (4) The listens graph now re-centers on the playing track whenever it changes (next/prev/auto-advance/radio), matching a node click.

## 2026-07-05 — Fix listens sync "session expired" loop + real admin gating

Root-caused the long-standing listens sync failure: `browser.json` stored the pasted `accept-encoding: gzip, deflate, br, zstd`, so YouTube replied brotli/zstd that the server's `requests` couldn't decode — every sync raised a JSONDecodeError that masqueraded as an expired session. The `_is_logged_in` probe stripped `accept-encoding`, so it always reported "logged in" while real calls failed, hiding the bug across several fix attempts. Added `_sanitize_headers()` (drops `accept-encoding` + stale `content-*`) applied on both save and load, so the existing on-disk credentials auto-heal with no re-auth. Separately, made admin gating actually validate the token against `/api/auth/check/` (shared `useIsAdmin` hook) instead of merely checking a token string exists — a stale/expired token no longer surfaces admin controls on listens/watches/reads/codes/bets/plays/yaps.

## 2026-03-31 — Floating feedback button

Added a site-wide floating feedback button (bottom-right corner) so visitors can leave anonymous messages. Backend: new Feedback model + POST /api/feedback/ endpoint, rate-limited to 1 per hour per IP. Frontend: expandable chat-bubble button styled like the ComposeSprite input, adapts to each page's --accent color.

## 2026-03-29 — Security hardening + server rebuild after ransomware

Hardened server attack surface after ransomware incident: bound PostgreSQL and Redis to `127.0.0.1` only (previously exposed to internet on `0.0.0.0`), moved postgres credentials to env vars, added Redis-backed rate limiting to the login endpoint (replacing in-memory dict), switched to `hmac.compare_digest` for timing-safe secret comparison. Added CSP header to Caddyfile, `SameSite=Strict` on session/CSRF cookies, fixed an open redirect in the `/sudo` login page, and created the missing `infra/nextjs.service` systemd unit. Updated `docs/infrastructure.md` with first-time server setup steps for the new Hetzner server (IP: 46.224.162.194).

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
