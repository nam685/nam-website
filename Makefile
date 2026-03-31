# nam-website development actions
# Usage: make <target>

.PHONY: help up down restart db-reset db-seed migrate test test-be test-fe lint format build dev

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Infrastructure ──────────────────────────────────

up: ## Start PostgreSQL + Redis containers
	docker compose up -d

down: ## Stop all containers
	docker compose down

restart: down up ## Restart containers

# ── Database ────────────────────────────────────────

migrate: ## Run Django migrations
	uv run python manage.py migrate

db-reset: ## Drop and recreate database (WARNING: destroys all data)
	docker compose exec db psql -U postgres -c "DROP DATABASE IF EXISTS nam_website;"
	docker compose exec db psql -U postgres -c "CREATE DATABASE nam_website;"
	uv run python manage.py migrate

db-seed: migrate ## Run migrations (includes data migrations that seed initial data)
	@echo "Database seeded via migrations"

db-shell: ## Open psql shell
	docker compose exec db psql -U postgres -d nam_website

# ── Development servers ─────────────────────────────

dev: ## Start Django + Next.js dev servers (background)
	@echo "Starting Django..."
	uv run python manage.py runserver &
	@echo "Starting Next.js..."
	cd frontend && npx pnpm dev &
	@echo "Django: http://localhost:8000"
	@echo "Next.js: http://localhost:3001"

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
