# Frontrun Timer

Race timing web app for a yearly club run (100–200 participants), replacing an
Excel/VBA workbook. FastAPI + SQLAlchemy 2 backend (`backend/`, managed with
uv), React/TS/Vite frontend (`frontend/`). SQLite for dev/tests, Postgres
(Neon) in production — keep models portable across both (string enums,
tz-aware UTC datetimes via `UTCDateTime`).

## Domain rules (authoritative)

- **Event** → **Race** (5 km / 10 km; start independently) → **Participant** / **FinishRecord**.
- **Elapsed time is always derived**: `recorded_at − race.started_at`. NEVER
  store elapsed time — correcting a start time must retroactively fix all
  results. `Race.updated_at` is bumped on corrections so `since=` pollers refetch.
- **Bib numbers are unique per event** (across its races), enforced in
  `services/participants.py` (not a DB constraint — it spans races).
  Exception: a Paarlauf pair = exactly two participants in the same race
  sharing one bib and the same `pair_group`.
- **Categories are derived, never stored** (`services/categories.py`):
  Männer/Frauen/AllGender × race, plus "Paarlauf {race}" for participants with
  a `pair_group`. Decisions taken: pairs rank ONLY in Paarlauf (one place per
  pair); gender `x` ranks only in AllGender.
- **FinishRecord is append-only**: undo = status `voided`, never delete.
  Creation is **idempotent by `client_id`** (offline outbox replays safely).
  A second finish for a bib that already has an `ok` record becomes status
  `conflict` — never overwrite. `unassigned` = logged without a readable bib,
  assigned later via PATCH.
- Only `ok` records count for rankings; ties share a rank (1, 2, 2, 4).
- **No emails, ever**: Participant has no email column; the importer silently
  drops any email-looking column (see `services/importer.py`). Keep it that way.
- Participants have `source` = `import` | `day_of` (day-of registration).
- Public results only for `is_published` events; bib lookup is always public.
- Roles: `admin` (everything), `timer` (finish-line endpoints only:
  POST/GET finishes, PATCH finish). Users are created via
  `uv run python -m app.cli create-user` — no self-registration.

## Commands

```sh
cd backend
uv run pytest                    # tests (SQLite in-memory)
uv run ruff check .              # lint — keep it clean
uv run alembic upgrade head      # migrate (DATABASE_URL, default local SQLite)
uv run alembic revision --autogenerate -m "..."   # replace UTCDateTime refs
                                 # with sa.DateTime(timezone=True) in output
uv run python -m app.cli seed    # demo event + admin/admin, timer/timer
cd frontend && npm run build     # type-check + build
```

## Conventions

- Business logic lives in `backend/app/services/`, routers stay thin.
- Datetimes: always tz-aware UTC (`UTCDateTime` raises on naive values).
- Ask before adding any new dependency (backend or frontend).
- Frontend: `/admin/finish` is the critical page — offline-first PWA with an
  IndexedDB outbox (`src/outbox.ts`); finish timestamps are captured
  client-side at tap time. Other admin pages are TODO placeholders with the
  intended behavior documented in comments.
