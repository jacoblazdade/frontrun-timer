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
  Exception: a Paarlauf group = two or more participants in the same race
  sharing one bib and the same `pair_group` (no upper size limit).
- **Categories are derived, never stored** (`services/categories.py`):
  Männer/Frauen/AllGender × race, plus "Paarlauf {race}" for participants with
  a `pair_group`. Decisions taken: groups rank ONLY in Paarlauf (one place per
  group); AllGender is its own category — gender `x` only, NOT a combined
  ranking — so every non-pair participant is in exactly one of
  Männer / Frauen / AllGender.
- **A Paarlauf group is always AllGender and always the short race.** Gender
  `x` is forced on every write path (`pair_gender()` in
  `services/participants.py`, applied in the router and the importer), because
  a group ranks only as Paarlauf and an individual gender would never select a
  category. Leaving a group does NOT restore the old gender — it is not
  recorded. The race is a UI default only (`frontend/src/lib/paarlauf.ts`
  picks the shortest race by the distance in its name): race names are free
  text, so the server does not guess which race a group belongs in.
- **`Participant.registered`** = ticked off at the desk on race day ("showed
  up"). Imports start `False` (a registration is not an appearance); day-of
  registrations are created `True`. It is not a finish and does not affect
  rankings.
- **FinishRecord is append-only**: undo = status `voided`, never delete.
  Single deliberate exception: `DELETE /api/races/{id}/finishes` (admin) bulk-
  clears a race's finish list — for test entries or a false start.
  Creation is **idempotent by `client_id`** (offline outbox replays safely).
  A second finish for a bib that already has an `ok` record becomes status
  `conflict` — never overwrite. `unassigned` = logged without a readable bib,
  assigned later via PATCH.
- **Results import** (`services/results_import.py`) is the fallback for a race
  day where the app failed and timing fell back to the Excel workbook. The file
  supplies net times only; the bib decides the race and the app's participant
  record stays authoritative for identity. `recorded_at = started_at + elapsed`
  keeps elapsed derived; a race with no `started_at` gets one (event date,
  00:00) so results exist at all. `replace` **voids** the affected races'
  finishes rather than deleting them — append-only still holds; `merge` refuses
  to overwrite a bib that already has an `ok` record.
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
