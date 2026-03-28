# nam-website

Personal website. Django backend + Next.js frontend with Tailwind CSS.

## Tech Stack

- **Backend:** Python 3.12+, Django 5.1+, PostgreSQL 16, managed with uv
- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, TypeScript, pnpm
- **Infra:** Docker Compose (PostgreSQL + Redis), Caddy reverse proxy, systemd services

## Project Structure

- `config/` - Django project settings, URLs, WSGI/ASGI
- `website/` - Main Django app (models, views, API)
- `frontend/` - Next.js frontend app
- `frontend/src/app/` - Next.js App Router pages

## Commands

### Backend
```bash
uv run python manage.py runserver     # Dev server
uv run python manage.py migrate       # Run migrations
uv run python manage.py makemigrations # Create migrations
uv run pytest                          # Run tests
uvx ruff check .                       # Lint
uvx ruff format .                      # Format
```

### Frontend
```bash
cd frontend
pnpm dev        # Dev server (Turbopack)
pnpm build      # Production build
pnpm lint       # ESLint
pnpm format     # Prettier
```

### Infrastructure
```bash
docker compose up -d   # Start PostgreSQL + Redis
docker compose down    # Stop services
```

## Workflow

- Use a **worktree** for each new feature/fix (keeps main clean, isolates work)
- No local debugging — testing happens on prod after deploy

## Auth System

- Custom token-based admin auth (not Django's user system)
- Login via `POST /api/auth/login/` with `ADMIN_SECRET` env var
- Token: Django signing module, 7-day TTL, Bearer header
- Protected endpoints: thought creation, drawing upload
- Frontend: `/sudo` page for login, token stored in localStorage

## Deploy Architecture

- **Server:** Hetzner VPS, Caddy (auto-TLS), systemd for django + nextjs
- **Flow:** PR merge → GitHub Actions CI → SSH deploy to `~/nam-website-deploy`
- **Caddy routes:** `/api/*`, `/admin/*` → Django :8000; `/media/*` → file_server; `/*` → Next.js :3000

## Conventions

- Python: Ruff for linting/formatting (line-length=120)
- Frontend: Prettier + ESLint (next/core-web-vitals)
- Shared frontend types/helpers in `frontend/src/lib/` (api.ts, auth.ts)
- Environment variables via `.env` (see `.env.example`)
