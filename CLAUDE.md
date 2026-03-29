# nam-website

Personal website. Django + Next.js, deployed to Hetzner VPS (nam685.de).

## Stack
- **Backend:** Python 3.12+, Django 5.1+, PostgreSQL 16, Redis — managed with `uv`
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript — managed with `pnpm`
- **Deploy:** Caddy (auto-TLS), systemd, GitHub Actions CI → SSH deploy

## Commands
```bash
# Backend
uv run python manage.py runserver          # dev server
uv run python manage.py makemigrations     # create migrations
uv run python manage.py migrate            # apply migrations
uv run pytest                              # tests
uvx ruff check . && uvx ruff format .      # lint+format

# Frontend (cd frontend)
pnpm dev      # dev server (Turbopack)
pnpm build    # prod build
pnpm lint     # ESLint
pnpm test     # vitest

# Infra
docker compose up -d   # PostgreSQL + Redis
```

## Workflow
- **MUST use worktrees** for every feature/fix — **always** work in `.claude/worktrees/`, never directly on main. Create with: `git worktree add .claude/worktrees/my-feature -b feat/my-feature origin/main`
- Visually verify UI changes with `pnpm dev` + Playwright screenshots before pushing

## Auth
Custom token auth (not Django users). Login: `POST /api/auth/login/` with `ADMIN_SECRET` env var. Token via Django signing, 7-day TTL, Bearer header. Frontend: `/sudo` login page, token in localStorage.

## Conventions
- Python: Ruff (line-length=120). Auto-runs on save via PostToolUse hook.
- Frontend: Prettier + ESLint (next/core-web-vitals)
- Caddy routes: `/api/*`, `/admin/*` → Django :8000; `/media/*` → file_server; `/*` → Next.js :3000
