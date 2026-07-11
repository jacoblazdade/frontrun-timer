# Deployment

Frontrun Timer ships as a **single Docker image**: a Node stage builds the
Vite/React frontend, and a Python stage runs FastAPI (uvicorn) which serves both
the API and the built frontend as static files. Target host is **Fly.io** with a
**Neon Postgres** database, but the image runs anywhere that can run a container.

- App code: `backend/` (FastAPI + SQLAlchemy 2 + Alembic, managed with `uv`)
- Frontend: `frontend/` (React + TS + Vite, Tailwind + shadcn, PWA)
- Image: [`Dockerfile`](../Dockerfile) · Fly config: [`fly.toml`](../fly.toml)
- CI: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (ruff + pytest + frontend build)

> Status: the Docker/Fly scaffolding exists but the app has **not been deployed
> yet**. Work through this guide start to finish for the first release.

## Architecture at a glance

- FastAPI serves `/api/*` and mounts the built frontend at `/` with an SPA
  fallback to `index.html` (client-side routes like `/admin/finish` work on hard
  reload). Frontend and API are **same-origin**, so there is **no CORS config**.
- Sessions are stateless HMAC-signed cookies (argon2 password hashing):
  `httponly`, `samesite=lax`, and `secure` gated by `COOKIE_SECURE`.
- DB is SQLite locally, Postgres in production. `app/db.py:normalize_db_url`
  rewrites `postgres://…` / `postgresql://…` to the `postgresql+psycopg://`
  (psycopg3) driver, so a raw Neon connection string works as-is.
- Health check: `GET /api/health` → `{"ok": true}`.

## Environment variables

| Var               | Required in prod | Purpose |
| ----------------- | ---------------- | ------- |
| `DATABASE_URL`    | ✅ | Neon Postgres connection string (`postgres://…`) |
| `SECRET_KEY`      | ✅ | signs session cookies — use a long random value |
| `COOKIE_SECURE`   | ✅ (`1`) | only send the session cookie over HTTPS |
| `STATIC_DIR`      | set by image/fly (`/app/static`) | path to the built frontend |
| `SESSION_MAX_AGE` | optional | session lifetime in seconds (default 43200 = 12 h) |

## 1. Verify the production build locally (do this first)

Confirm the image actually builds — the frontend stage runs `npm ci && npm run
build`, which now includes Tailwind/shadcn/PWA, so it's worth a dry run before
touching Fly:

```sh
docker build -t frontrun-timer .
# smoke test against a throwaway SQLite DB inside the container
docker run --rm -p 8080:8080 -e SECRET_KEY=dev -e DATABASE_URL=sqlite:///./smoke.db frontrun-timer \
  sh -c "uv run --no-sync alembic upgrade head && uv run --no-sync python -m app.cli seed && \
         uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8080"
# then: curl localhost:8080/api/health   and open http://localhost:8080
```

(The normal container `CMD` just runs uvicorn; migrations run via Fly's
`release_command`. The line above bundles migrate+seed only for a local smoke.)

## 2. Provision Neon Postgres

1. Create a project + database at <https://neon.tech> (free tier is fine).
2. Copy the **connection string** (looks like
   `postgres://user:pass@ep-xxx.eu-central-1.aws.neon.tech/dbname?sslmode=require`).
3. No driver tweaks needed — `normalize_db_url` maps it to psycopg3.

## 3. Deploy to Fly.io

```sh
# one-time: create the app (reuses the existing fly.toml; don't let it overwrite)
fly launch --no-deploy

# secrets
fly secrets set SECRET_KEY=$(openssl rand -hex 32)
fly secrets set DATABASE_URL='postgres://…neon connection string…'
fly secrets set COOKIE_SECURE=1

# deploy — the release_command runs `alembic upgrade head` against Neon
fly deploy
```

`fly.toml` already sets `force_https = true`, `internal_port = 8080`, and
auto-stop/start machines (scale-to-zero) which is fine because Postgres lives in
Neon, not on the machine.

## 4. Create the first admin user

There is **no self-registration**. After the first deploy, create a real admin
over SSH (interactive password prompt):

```sh
fly ssh console -C "uv run --no-sync python -m app.cli create-user admin --role admin"
```

Do **not** ship the demo `admin/admin` and `timer/timer` accounts from `seed` to
production. Create `timer` accounts the same way with `--role timer`.

## 5. Verify

- `https://frontrun-timer.fly.dev/api/health` → `{"ok": true}`
- Open the site, log in as the admin you created.
- Create an event + races (Rennen page), import a start list, do a test finish,
  publish results, confirm the public results page updates.

## Ongoing

- **Schema changes**: add a migration with
  `cd backend && uv run alembic revision --autogenerate -m "…"` (replace any
  `UTCDateTime` refs in the generated file with `sa.DateTime(timezone=True)`),
  commit it; the next `fly deploy` applies it via `release_command`.
- **App updates**: `fly deploy` rebuilds the image. The PWA service worker is
  `autoUpdate`, so clients pick up new frontend builds on next load.
- **CI**: pushes/PRs run ruff + pytest + a frontend build. Keep it green.

## Production checklist

- [ ] `SECRET_KEY` is a fresh random value (not the dev default)
- [ ] `COOKIE_SECURE=1` and the app is only reachable over HTTPS
- [ ] `DATABASE_URL` points at Neon; `alembic upgrade head` ran (check release logs)
- [ ] Real admin/timer users created via CLI; demo accounts absent
- [ ] `GET /api/health` returns 200
- [ ] A test event end-to-end works (register → finish → published results)

## Troubleshooting

- **Frontend build fails in Docker**: run `cd frontend && npm ci && npm run build`
  locally to reproduce; the Node stage uses the committed `package-lock.json`.
- **DB connection errors**: ensure the Neon string includes `?sslmode=require`;
  confirm `psycopg[binary]` installed (it's in `pyproject.toml`).
- **Login works but immediately logs out**: `COOKIE_SECURE=1` without HTTPS drops
  the cookie — make sure requests are HTTPS (Fly's `force_https` handles this).
- **Blank page / 404 on refresh of an admin route**: confirm `STATIC_DIR` is set
  and the SPA fallback is active (it is in `app/main.py` when `STATIC_DIR` exists).
