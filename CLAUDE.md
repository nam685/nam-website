# nam-website

Personal website. Django + Next.js, deployed to Hetzner VPS (nam685.de).

## Stack
- **Backend:** Python 3.12+, Django 6.0+, PostgreSQL 16, Redis — managed with `uv`
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript — managed with `pnpm`
- **Deploy:** Caddy (auto-TLS), systemd, GitHub Actions CI → SSH deploy

## Commands
```bash
# Backend (run from repo root)
uv run python manage.py runserver          # dev server → http://localhost:8000
uv run python manage.py makemigrations     # create migrations
uv run python manage.py migrate            # apply migrations
uv run pytest                              # tests (conftest.py fixtures in root)
uvx ruff check . && uvx ruff format .      # lint+format (hook auto-fixes on save)

# Frontend (cd frontend)
pnpm dev      # dev server (Turbopack) → http://localhost:3001
pnpm build    # prod build
pnpm lint     # ESLint (custom flat config)
pnpm format   # Prettier
pnpm test     # vitest

# Infra
docker compose up -d   # PostgreSQL + Redis
```

## Workflow
- **MUST use worktrees** for every feature/fix — **always** work in `.claude/worktrees/`, never directly on main. Create with: `git worktree add .claude/worktrees/my-feature -b feat/my-feature origin/main`
- Visually verify UI changes with `pnpm dev` + Playwright screenshots before pushing

## Django App Structure
The `website/` app uses **split subdirectories** (not flat files):
- `website/models/<name>.py` — one file per model, exported via `models/__init__.py`
- `website/views/<name>.py` — one file per view group, exported via `views/__init__.py`
- `website/urls.py` — all routes under `/api/`
- `website/auth.py` — `require_admin` decorator, `create_token`/`verify_token`
- `website/utils.py` — shared helpers (`get_client_ip`, `parse_json_body`)
- `website/tests/test_<name>.py` — pytest tests

**Never create flat `website/models.py` or `website/views.py`** — they conflict with the `__init__.py` re-exports.

When adding a new model: create `website/models/<name>.py`, add import to `models/__init__.py`, add to `__all__`.
When adding a new view: create `website/views/<name>.py`, add imports to `views/__init__.py`, add URL in `urls.py`.

## API Endpoints
All under `/api/` (Caddy proxies to Django :8000):
```
GET  /api/health/
POST /api/auth/login/           body: {"secret": "<ADMIN_SECRET>"} → {"token": "..."}
GET  /api/auth/check/           Authorization: Bearer <token>
GET  /api/thoughts/?page=N
POST /api/thoughts/create/      auth required, body: {"content": "..."}
GET  /api/drawings/
POST /api/drawings/upload/      auth required, multipart (image + category)
POST /api/drawings/<id>/delete/ auth required
POST /api/feedback/             body: {"message": "..."}, rate-limited per IP
GET  /api/projects/
GET  /api/todo/
GET  /api/github/contributions/
GET  /api/github/auth/          auth required, initiates GitHub OAuth
GET  /api/github/callback/
GET  /api/github/refresh-status/ auth required
GET  /api/listens/?limit=N&offset=N
GET  /api/listens/tracks/       top tracks by play count
GET  /api/listens/artists/      top artists by play count
GET  /api/listens/albums/       top albums by play count
GET  /api/listens/recommended/   recommended track (rediscovery algorithm)
GET  /api/listens/stats/
POST /api/listens/sync/         auth required, triggers YTM history sync
GET  /api/listens/sync-status/  auth required
POST /api/listens/import/       auth required, Google Takeout file upload
GET  /api/watches/?limit=N&offset=N
GET  /api/watches/staging/      auth required
POST /api/watches/channels/<id>/tier/   auth required, body: {"tier": "..."}
POST /api/watches/channels/<id>/order/  auth required, body: {"display_order": N}
POST /api/watches/channels/<id>/delete/ auth required
POST /api/watches/videos/<id>/pin/      auth required, toggles pin+visible
POST /api/watches/videos/<id>/note/     auth required, body: {"note": "..."}
POST /api/watches/videos/<id>/delete/   auth required
GET  /api/watches/auth/         auth required, initiates Google OAuth
GET  /api/watches/callback/     Google OAuth callback
POST /api/watches/sync/         auth required, triggers YouTube sync
GET  /api/watches/sync-status/  auth required
GET  /api/watches/recommended/    random weighted pinned video for hero
POST /api/watches/backfill-stats/ auth required, backfills stale video stats
GET  /api/bets/                    all tickers with latest price + sparkline
GET  /api/bets/<id>/history/       price history, ?period=1W|1M|3M|1Y|ALL
POST /api/bets/create/             auth required, body: {symbol, name, asset_type, provider, provider_id, currency}
POST /api/bets/<id>/delete/        auth required
POST /api/bets/sync/               auth required, triggers price fetch
GET  /api/bets/sync-status/        auth required
GET  /api/bets/search/?q=...       auth required, searches Alpha Vantage + CoinGecko
GET  /api/lichess/auth/         auth required, initiates Lichess OAuth (PKCE)
GET  /api/lichess/callback/     Lichess OAuth callback
GET  /api/lichess/token/        auth required, returns stored Lichess token
GET  /api/lichess/status/       public, returns connection status
GET  /api/slops/                    session list (paginated, with turns)
GET  /api/slops/<id>/               single session detail with turns
GET  /api/slops/<id>/trace/         ATIF trace file contents
POST /api/slops/submit/             submit prompt (1/hr/IP + 10/hr global), optional session_id for follow-up
POST /api/slops/turns/<id>/approve/ auth required, approve turn + queue
POST /api/slops/turns/<id>/reject/  auth required, reject turn
GET  /api/slops/stats/              aggregate stats (from turns)
```

## Auth
Custom token auth (not Django users). Login: `POST /api/auth/login/` with JSON body `{"secret": "<ADMIN_SECRET>"}`. Rate-limited to 15 attempts / 15 min per IP via Redis. Token via Django signing, 7-day TTL. Bearer header for protected endpoints. Frontend: `/sudo` login page, token stored under `adminToken` key in localStorage.

Frontend auth helpers in `frontend/src/lib/auth.ts`:
- `store(key)` / `storeDel(key)` — SSR-safe localStorage wrappers (always use these, never raw `localStorage`)
- `getAdminToken()` — returns token or redirects to `/sudo`

## Frontend Patterns

### API calls
Import from `@/lib/api`:
- `API` — empty string for client-side (Caddy proxies `/api/*`)
- `API_INTERNAL` — `http://localhost:8000` for server-side Next.js fetches
- Always use `${API}/api/<endpoint>/` for client-side fetches

### Accent color system
Each nav page has a unique `--accent` CSS variable. When adding a page to the nav:
1. Add entry to `NAV_ITEMS` in `frontend/src/lib/navWheel.ts`
2. Add to the `m` map in the inline `<script>` in `frontend/src/app/layout.tsx`

Missing either step causes an accent color flash on uncached loads.

### Shared components
- `components/CyberGrid.tsx` — SVG grid background pattern (used by codes + reads)
- `components/PageBackground.tsx` — page-specific background images
- `components/Navbar.tsx` — nav wheel + mobile nav
- `components/FeedbackButton.tsx` — floating feedback form

### Styling
- Inline styles used for dynamic/accent-colored elements
- Tailwind used for utility layout
- `globals.css` has shared classes: `.tag`, `.corner-tl`/`.corner-tr`/`.corner-bl`/`.corner-br`
- Shared keyframes in `globals.css`: `fadeIn`, `fadeUp`, `hexFloat`
- Pure utility functions go in `frontend/src/lib/` for testability

## Testing

### Backend (pytest + pytest-django)
- Run from repo root: `uv run pytest`
- Test files: `website/tests/test_<name>.py`
- Shared fixtures in `conftest.py`: `admin_token`, `auth_headers`, `_disable_ssl_redirect`
- Use `@pytest.mark.django_db` for DB tests

### Frontend (vitest)
- Tests in `frontend/src/lib/__tests__/`
- Node environment for pure logic tests
- Only test exported pure functions in `src/lib/`

## Conventions
- Python: Ruff (line-length=120). PostToolUse hook auto-runs `ruff check --fix` + `ruff format` on `.py` saves.
- Frontend: Prettier (semi, double quotes, 2-space indent, trailing commas) + ESLint (custom flat config in `eslint.config.mjs`)
- Caddy routes: `/api/*`, `/admin/*` → Django :8000; `/media/*` → file_server; `/*` → Next.js :3000

## Environment Variables
Backend (`.env`, see `.env.example`):
- `SECRET_KEY` — Django secret key (required, no default)
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis URL (default: `redis://localhost:6379/0`)
- `ADMIN_SECRET` — secret for `/api/auth/login/` (required, no default)
- `ALLOWED_HOSTS` — comma-separated (must include `nam685.de` in prod)
- `CORS_ALLOWED_ORIGINS` — comma-separated allowed origins
- `CSRF_TRUSTED_ORIGINS` — comma-separated trusted origins
- `DEBUG` — boolean (default: False)

Frontend:
- `NEXT_PUBLIC_API_URL` — API base URL; empty in prod (Caddy proxies), `http://localhost:8000` for local dev without Caddy

## Documentation
- `docs/README.md` — Customer-facing description of what the website is and does. **Update when adding/removing pages or features.**
- `docs/QA-CHECKLIST.md` — Manual QA checklist for quality audits. **Add corresponding items when adding new features or pages.**
- `docs/infrastructure.md` — Server setup and deployment instructions.

**Important:** When adding a new page or feature, you MUST:
1. Update `docs/README.md` with a description of the new section
2. Add QA test items to `docs/QA-CHECKLIST.md`
3. Follow the existing QA checklist when verifying your changes work correctly

## Backlog
Issue tracker lives in `backlog/` — one `.md` file per ticket with YAML frontmatter (status, priority, labels). See `backlog/README.md` for conventions. Prefer this over TODO.md for anything that spans multiple sessions.

## Dev Actions
Common tasks are available via `make`:
```bash
make help          # show all available commands
make up            # full dev boot: containers + migrate + seed + dev servers
make down          # stop containers
make dev           # start Django + Next.js dev servers (no setup)
make db-reset      # drop + recreate database
make db-seed       # run migrations + seed
make dumpseed      # export current DB to fixtures/seed.json
make sync          # show instructions for live API syncs
make test          # run all tests (backend + frontend)
make lint          # run all linters
make format        # format all code
```
