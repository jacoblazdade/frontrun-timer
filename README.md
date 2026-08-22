# Frontrun Timer

Race timing web app for the yearly club run (100–200 participants).
Replaces the old Excel/VBA workbook.

- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2 + Alembic, managed with [uv](https://docs.astral.sh/uv/)
- **Frontend**: React + TypeScript + Vite (in `frontend/`), served as static files in production
- **DB**: SQLite locally, Postgres (Neon) in production
- Domain rules live in [CLAUDE.md](CLAUDE.md)

## Local development

Backend (uses `backend/frontrun.db`, a local SQLite file):

```sh
cd backend
uv sync                          # install dependencies
uv run alembic upgrade head      # create/migrate the database
uv run python -m app.cli seed    # demo event + users admin/admin, timer/timer
uv run uvicorn app.main:app --reload   # API on http://localhost:8000
```

Frontend (dev server proxies `/api` to :8000):

```sh
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Create additional users (no self-registration exists):

```sh
uv run python -m app.cli create-user alice --role admin   # prompts for password
uv run python -m app.cli create-user zielrichter --role timer
```

## Tests & lint

```sh
cd backend
uv run pytest
uv run ruff check .
```

CI (GitHub Actions) runs both plus a frontend type-check/build on every push.

## Deploying to Fly.io

One Docker image serves the API and the built frontend. Migrations run as the
release command (see `fly.toml`). **Full step-by-step guide: [docs/DEPLOY.md](docs/DEPLOY.md).**

```sh
fly launch --no-deploy                     # once; reuses fly.toml
fly secrets set SECRET_KEY=$(openssl rand -hex 32)
fly secrets set DATABASE_URL=postgres://…  # Neon connection string
fly secrets set COOKIE_SECURE=1
fly deploy
fly ssh console -C "uv run --no-sync python -m app.cli create-user admin"
```

## Configuration

| Env var           | Default                  | Purpose                          |
| ----------------- | ------------------------ | -------------------------------- |
| `DATABASE_URL`    | `sqlite:///./frontrun.db`| SQLAlchemy URL (Neon: postgres://…) |
| `SECRET_KEY`      | dev value                | signs session cookies — set in prod |
| `COOKIE_SECURE`   | `0`                      | set `1` behind HTTPS             |
| `SESSION_MAX_AGE` | `43200` (12 h)           | session lifetime in seconds      |
| `STATIC_DIR`      | unset                    | path to built frontend to serve  |

## What's next

Ideas collected during the 2026 race, with dependencies and the decisions
already taken: **[docs/ROADMAP.md](docs/ROADMAP.md)**.
