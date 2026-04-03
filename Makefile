# nam-website development actions
# Usage: make <target>

.PHONY: help up down restart db-reset db-seed db-shell migrate test test-be test-fe lint format build dev dev-be dev-fe sync dumpseed shell collectstatic makemigrations

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Infrastructure ──────────────────────────────────

up: ## Full dev boot: containers + migrate + seed + dev servers
	docker compose up -d
	@echo "Waiting for PostgreSQL..."
	@until docker compose exec db pg_isready -U postgres -q 2>/dev/null; do sleep 0.5; done
	@echo "PostgreSQL ready."
	uv run python manage.py migrate --run-syncdb
	uv run python manage.py seed
	@echo ""
	@echo "=== Dev servers starting ==="
	@echo "Django:  http://localhost:8000"
	@echo "Next.js: http://localhost:3001"
	@echo ""
	@trap 'kill 0' INT TERM; \
		uv run python manage.py runserver & \
		cd frontend && npx pnpm dev & \
		wait

down: ## Stop all containers
	docker compose down

restart: down up ## Restart everything

# ── Database ────────────────────────────────────────

migrate: ## Run Django migrations
	uv run python manage.py migrate

db-reset: ## Drop and recreate database (WARNING: destroys all data)
	docker compose exec db psql -U postgres -c "DROP DATABASE IF EXISTS nam_website;"
	docker compose exec db psql -U postgres -c "CREATE DATABASE nam_website;"
	uv run python manage.py migrate

db-seed: migrate ## Run migrations + seed
	uv run python manage.py seed

db-shell: ## Open psql shell
	docker compose exec db psql -U postgres -d nam_website

# ── Seed data ──────────────────────────────────────

dumpseed: ## Export current DB to fixtures/seed.json
	uv run python manage.py dumpseed

sync: ## Show instructions for triggering live API syncs
	@echo ""
	@echo "=== Live API Sync ==="
	@echo ""
	@echo "First, get an admin token:"
	@echo "  curl -s -X POST http://localhost:8000/api/auth/login/ \\"
	@echo "    -H 'Content-Type: application/json' \\"
	@echo "    -d '{\"secret\": \"<ADMIN_SECRET>\"}'"
	@echo ""
	@echo "Watches (YouTube):"
	@echo "  Authenticate: http://localhost:8000/api/watches/auth/?token=<TOKEN>"
	@echo "  Then sync:    curl -X POST http://localhost:8000/api/watches/sync/ -H 'Authorization: Bearer <TOKEN>'"
	@echo ""
	@echo "Listens (YouTube Music):"
	@echo "  Visit: http://localhost:8000/api/listens/auth/?token=<TOKEN>"
	@echo ""
	@echo "GitHub Contributions:"
	@echo "  Visit: http://localhost:8000/api/github/auth/?token=<TOKEN>"
	@echo ""
	@echo "Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID,"
	@echo "GITHUB_CLIENT_SECRET in .env"
	@echo ""

# ── Development servers ─────────────────────────────

dev: ## Start Django + Next.js dev servers (no setup)
	@echo "Django:  http://localhost:8000"
	@echo "Next.js: http://localhost:3001"
	@trap 'kill 0' INT TERM; \
		uv run python manage.py runserver & \
		cd frontend && npx pnpm dev & \
		wait

dev-be: ## Start Django dev server only
	uv run python manage.py runserver

dev-fe: ## Start Next.js dev server only
	cd frontend && npx pnpm dev

# ── Testing ─────────────────────────────────────────

test: test-be test-fe ## Run all tests

test-be: ## Run backend tests (pytest)
	uv run pytest

test-fe: ## Run frontend tests (vitest)
	cd frontend && npx pnpm test

# ── Code quality ────────────────────────────────────

lint: ## Run all linters
	uvx ruff check .
	cd frontend && npx pnpm lint

format: ## Format all code
	uvx ruff check --fix .
	uvx ruff format .
	cd frontend && npx pnpm format

# ── Build ───────────────────────────────────────────

build: ## Build frontend for production
	cd frontend && npx pnpm build

# ── Utilities ───────────────────────────────────────

shell: ## Open Django shell
	uv run python manage.py shell

collectstatic: ## Collect static files
	uv run python manage.py collectstatic --noinput

makemigrations: ## Create new migrations
	uv run python manage.py makemigrations
