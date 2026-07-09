"""Result computation.

Elapsed time is ALWAYS derived (recorded_at − race.started_at) and never
stored, so a corrected start time retroactively fixes all results.

Only status=ok finish records count. A Paarlauf pair shares one bib and one
finish record and occupies exactly one place in the ranking.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, FinishRecord, FinishStatus, Participant
from app.services.categories import categories_for


@dataclass
class ResultRow:
    category: str
    rank: int
    bib: int
    name: str
    birth_year: int | None
    club: str | None
    elapsed_seconds: float
    changed_at: datetime


def format_elapsed(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def event_results(
    db: Session,
    event: Event,
    category: str | None = None,
    since: datetime | None = None,
) -> tuple[list[str], list[ResultRow]]:
    """Returns (all category names with results, ranked rows).

    Ranks are always computed over the full field; `category` and `since`
    only filter the returned rows, so a poll with `since` still carries the
    correct global rank per row.
    """
    unranked: dict[str, list[tuple]] = {}

    for race in event.races:
        if race.started_at is None:
            continue

        participants = db.scalars(
            select(Participant).where(Participant.race_id == race.id)
        ).all()
        by_bib: dict[int, list[Participant]] = {}
        for p in participants:
            by_bib.setdefault(p.bib, []).append(p)

        finishes = db.scalars(
            select(FinishRecord)
            .where(
                FinishRecord.race_id == race.id,
                FinishRecord.status == FinishStatus.ok,
                FinishRecord.bib.is_not(None),
            )
            .order_by(FinishRecord.recorded_at)
        ).all()

        seen_bibs: set[int] = set()
        for fin in finishes:
            if fin.bib in seen_bibs:
                continue  # defensive: duplicates are stored as 'conflict', not 'ok'
            seen_bibs.add(fin.bib)
            parts = by_bib.get(fin.bib)
            if not parts:
                continue  # finish for an unknown bib — visible on the finish screen only
            elapsed = (fin.recorded_at - race.started_at).total_seconds()
            if len(parts) > 1:  # Paarlauf pair: one row, one place
                name = " & ".join(f"{p.first_name} {p.last_name}" for p in parts)
                birth_year = None
            else:
                name = f"{parts[0].first_name} {parts[0].last_name}"
                birth_year = parts[0].birth_year
            changed_at = max(fin.updated_at, race.updated_at)
            for cat in categories_for(parts[0], race.name):
                unranked.setdefault(cat, []).append(
                    (elapsed, fin.bib, name, birth_year, parts[0].club, changed_at)
                )

    results: list[ResultRow] = []
    for cat, rows in unranked.items():
        rows.sort(key=lambda r: r[0])
        rank = 0
        prev_elapsed: float | None = None
        for i, (elapsed, bib, name, birth_year, club, changed_at) in enumerate(rows, start=1):
            if elapsed != prev_elapsed:  # ties share a rank (1, 2, 2, 4)
                rank = i
                prev_elapsed = elapsed
            results.append(
                ResultRow(cat, rank, bib, name, birth_year, club, elapsed, changed_at)
            )

    categories = sorted(unranked)
    if category is not None:
        results = [r for r in results if r.category == category]
    if since is not None:
        results = [r for r in results if r.changed_at > since]
    results.sort(key=lambda r: (r.category, r.rank, r.bib))
    return categories, results
