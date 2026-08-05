"""Results import from an XLSX/Numbers/CSV finish list — the fallback path.

If the app fails on race day and timing falls back to the old Excel workbook,
this reads that sheet back in and makes it what the app shows. The columns of
the app's own results export (`services/exporter.py`) are recognised, so an
exported file can be corrected in Excel and imported straight back.

The domain rules still hold:

- **Elapsed time is never stored.** Times in the file are *net* running times;
  each row becomes a FinishRecord with `recorded_at = race.started_at +
  elapsed`, so correcting the start time afterwards still fixes every result.
- **Finish records are append-only.** 'replace' deletes nothing: it *voids*
  the finish records of every race the file touches and appends the imported
  ones, so the original timing stays auditable.
- **The bib decides the race** (bibs are unique per event), so no race column
  is needed — and a bib that is not registered in the event is an error.

All-or-nothing like the participant importer: if any row has an error nothing
is committed and the report says what to fix.
"""

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Event,
    FinishRecord,
    FinishStatus,
    Participant,
    Race,
    RaceStatus,
    utcnow,
)
from app.services.importer import RowError, looks_like_email

RESULT_FIELDS = {"bib", "time"}

# replace: void every existing finish of the races the file touches, then
#          import — the file becomes the truth (the fallback-to-Excel case).
# merge:   keep what is stored and only add times; a bib that already has an
#          'ok' finish is reported instead of being overwritten (the case where
#          only part of the field was hand-timed).
REPLACE = "replace"
MERGE = "merge"
MODES = (REPLACE, MERGE)

_FRACTIONAL = r"\d{1,2}(?:[.,]\d+)?"
_ELAPSED_RE = re.compile(
    rf"^(?:(?P<days>\d+)\s*days?,\s*)?(?P<a>\d+):(?P<b>{_FRACTIONAL})(?::(?P<c>{_FRACTIONAL}))?$"
)
# Excel hands a time-formatted cell back on its 1899-12-30 epoch date
_DATE_TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T](?P<time>\d{1,2}:\d{2}(?::\d{1,2}(?:\.\d+)?)?)$")


def parse_elapsed(raw: str) -> float:
    """Net running time of a cell, in seconds.

    Accepts `H:MM:SS(.f)`, `MM:SS` (minutes may exceed 59), a bare number of
    seconds, an Excel day fraction (a bare number below 1), and the
    `1899-12-30 00:42:15` shape Excel returns for a time-formatted cell.
    A German decimal comma is accepted. Raises ValueError on anything else,
    including a non-positive time (a mis-mapped column).
    """
    text = raw.strip()
    if not text:
        raise ValueError("empty")

    epoch = _DATE_TIME_RE.match(text)
    if epoch:
        text = epoch.group("time")

    match = _ELAPSED_RE.match(text)
    if match:
        a, b, c = match.group("a"), match.group("b"), match.group("c")
        if c is None:  # MM:SS — 95:12 is a legitimate 10 km time
            hours, minutes, seconds = 0, int(a), float(b.replace(",", "."))
        else:  # H:MM:SS — only the seconds may carry a fraction
            if not b.isdigit():
                raise ValueError("minutes must be a whole number")
            hours, minutes, seconds = int(a), int(b), float(c.replace(",", "."))
            if minutes >= 60:
                raise ValueError("minutes out of range")
        if seconds >= 60:
            raise ValueError("seconds out of range")
        total = int(match.group("days") or 0) * 86400 + hours * 3600 + minutes * 60 + seconds
    else:
        value = float(text.replace(",", "."))  # raises ValueError if unreadable
        # a bare number below 1 is Excel's "fraction of a day" for a time cell
        total = value * 86400 if value < 1 else value

    if total <= 0:
        raise ValueError("time must be greater than zero")
    return total


@dataclass
class ResultsImportResult:
    total_rows: int = 0
    valid_rows: int = 0
    errors: list[RowError] = field(default_factory=list)
    dropped_columns: list[str] = field(default_factory=list)
    # mappable columns found in the file — lets the UI offer a column mapping
    columns: list[str] = field(default_factory=list)
    races: list[str] = field(default_factory=list)  # races the file touches
    started_races: list[str] = field(default_factory=list)  # given a start time
    voided: int = 0  # existing finish records voided by 'replace'
    created: int = 0
    committed: bool = False


def import_results(
    db: Session,
    event: Event,
    *,
    rows: list[dict[str, str]],
    mapping: dict[str, str],
    mode: str = REPLACE,
    created_by: str = "import",
    dry_run: bool = True,
) -> ResultsImportResult:
    """`mapping` maps result field name ('bib', 'time') -> source column header."""
    result = ResultsImportResult(total_rows=len(rows))

    all_columns: dict[str, None] = {}  # dict keeps the file's column order
    for row in rows:
        all_columns.update(dict.fromkeys(row.keys()))
    result.dropped_columns = sorted(c for c in all_columns if looks_like_email(c))
    result.columns = [c for c in all_columns if not looks_like_email(c)]

    if mode not in MODES:
        result.errors.append(RowError(row=0, message=f"unknown mode {mode!r}"))
        return result

    mapping = {
        f: col for f, col in mapping.items() if f in RESULT_FIELDS and not looks_like_email(col)
    }
    for required in ("bib", "time"):
        if required not in mapping:
            result.errors.append(RowError(row=0, message=f"mapping for '{required}' is missing"))
            return result

    # the bib decides the race — bibs are unique per event
    by_bib: dict[int, Participant] = {}
    for p in db.scalars(
        select(Participant)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event.id)
    ):
        by_bib.setdefault(p.bib, p)  # a Paarlauf group shares one bib and one time

    races_by_id = {r.id: r for r in event.races}
    # bibs that already hold an 'ok' finish: 'merge' must never overwrite one
    already_finished = set(
        db.scalars(
            select(FinishRecord.bib)
            .join(Race, FinishRecord.race_id == Race.id)
            .where(
                Race.event_id == event.id,
                FinishRecord.status == FinishStatus.ok,
                FinishRecord.bib.is_not(None),
            )
        )
    )

    parsed: list[tuple[int, int, float]] = []  # (race_id, bib, elapsed seconds)
    seen: dict[int, int] = {}  # bib -> row it first appeared in
    touched: dict[int, Race] = {}

    for idx, raw in enumerate(rows, start=2):  # row 1 is the header

        def get(fieldname: str, row=raw) -> str:
            return row.get(mapping[fieldname], "").strip()

        bib_raw = get("bib")
        try:
            bib = int(float(bib_raw))
        except ValueError:
            result.errors.append(RowError(row=idx, message=f"invalid bib {bib_raw!r}"))
            continue
        if bib in seen:
            result.errors.append(
                RowError(row=idx, message=f"bib {bib} appears twice (also in row {seen[bib]})")
            )
            continue

        time_raw = get("time")
        try:
            elapsed = parse_elapsed(time_raw)
        except ValueError:
            result.errors.append(
                RowError(row=idx, message=f"invalid time {time_raw!r} (use H:MM:SS or MM:SS)")
            )
            continue

        owner = by_bib.get(bib)
        if owner is None:
            result.errors.append(
                RowError(
                    row=idx,
                    message=f"bib {bib} is not registered in this event — add the runner first",
                )
            )
            continue

        if mode == MERGE and bib in already_finished:
            result.errors.append(
                RowError(
                    row=idx,
                    message=(
                        f"bib {bib} already has a finish time in the app — "
                        "use replace mode or drop the row"
                    ),
                )
            )
            continue

        race = races_by_id[owner.race_id]
        seen[bib] = idx
        touched[race.id] = race
        parsed.append((race.id, bib, elapsed))
        result.valid_rows += 1

    result.races = [race.name for race in touched.values()]
    if result.errors or dry_run:
        return result

    now = utcnow()
    for race in touched.values():
        if race.started_at is None:
            # Nothing to anchor the elapsed times to. Only differences are ever
            # shown, so the absolute value is arbitrary: pin it to the event
            # date and mark the race done. Races that already ran keep theirs.
            race.started_at = datetime(
                event.date.year, event.date.month, event.date.day, tzinfo=UTC
            )
            race.status = RaceStatus.finished
            result.started_races.append(race.name)

    if mode == REPLACE:
        # append-only: the previous timing is voided, never deleted
        stale = db.scalars(
            select(FinishRecord).where(
                FinishRecord.race_id.in_(touched),
                FinishRecord.status != FinishStatus.voided,
            )
        ).all()
        for record in stale:
            record.status = FinishStatus.voided
        result.voided = len(stale)

    for race_id, bib, elapsed in parsed:
        db.add(
            FinishRecord(
                race_id=race_id,
                bib=bib,
                recorded_at=touched[race_id].started_at + timedelta(seconds=elapsed),
                client_id=str(uuid.uuid4()),
                status=FinishStatus.ok,
                created_by=created_by,
            )
        )

    for race in touched.values():
        race.updated_at = now  # so result pollers (`since=`) refetch

    db.flush()
    result.created = len(parsed)
    result.committed = True
    return result
