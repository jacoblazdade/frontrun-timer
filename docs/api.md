# API overview

Interactive docs: `/docs` (Swagger UI) when the backend is running.

## Public (no auth)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/events` | published events with their races |
| `GET /api/events/{id}/results?category=&since=` | ranked results; `since` (ISO timestamp, use the previous response's `server_time`) returns only changed rows — ranks stay global |
| `GET /api/races/{id}/lookup?bib=` | bib → runner name (announcer) |

## Auth

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/login` | `{username, password}` → session cookie |
| `POST /api/auth/logout` | clears the cookie |
| `GET /api/auth/me` | current user |

## Timer + admin (finish line)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/races/{id}/finishes` | `{client_id, bib\|null, recorded_at}` — idempotent by `client_id` (201 created / 200 replay) |
| `GET /api/races/{id}/finishes?limit=` | recent entries, newest first |
| `PATCH /api/finishes/{id}` | `{status: "voided"}` (undo) or `{bib: n}` (assign) |

## Admin only

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/events` | all events incl. unpublished |
| `POST /api/events` | create next year's event: `{name, date, races: ["5 km", "10 km"]}`, starts unpublished |
| `PATCH /api/events/{id}` | publish (`is_published`), rename |
| `POST /api/events/{id}/start-races` | start all not-yet-started races with ONE shared gun time |
| `POST /api/races/{id}/start` | set `started_at=now`, status running |
| `PATCH /api/races/{id}` | correct `started_at` (or `null` to un-start), set status |
| `DELETE /api/races/{id}/finishes` | bulk-clear a race's finish records (false start / test entries) — the only exception to append-only |
| `GET/POST/PATCH/DELETE` participants | CRUD (`/api/events/{id}/participants`, `/api/participants[/{id}]`) |
| `POST /api/events/{id}/import` | multipart: `file` (XLSX/CSV), `mapping` (JSON field→column), `dry_run`, `default_race_id`; returns a validation report; email columns are dropped silently |
| `GET /api/events/{id}/next-bib` | next free bib for day-of registration |
| `GET /api/events/{id}/export.xlsx` | results workbook, one sheet per category |
