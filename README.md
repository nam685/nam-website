# nam-website

Personal website. Django backend + Next.js frontend.

## Setup

### Prerequisites

- Python 3.12+, [uv](https://docs.astral.sh/uv/)
- Node 22+, [pnpm](https://pnpm.io/) 10
- Docker & Docker Compose

### Start services

```bash
docker compose up -d
```

### Backend

```bash
cp .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py runserver
```

Django runs at http://localhost:8000. Health check: http://localhost:8000/api/health/

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Next.js runs at http://localhost:3000.
