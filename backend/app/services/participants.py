"""Bib allocation and event-wide bib uniqueness.

Bibs are unique per EVENT (across its races). The single exception is a
Paarlauf pair: exactly two participants in the same race may share a bib if
they share the same non-empty pair_group.
"""

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Participant, Race


class BibConflictError(ValueError):
    pass


def list_event_participants(
    db: Session,
    event_id: int,
    *,
    q: str | None = None,
    page: int = 0,
    size: int = 50,
) -> tuple[list[Participant], int, int]:
    """Participants of an event ordered by bib, paginated for the admin table.

    Paging is by *entry*, not by row: a Paarlauf pair (two runners sharing a
    bib) counts as one entry and is never split across a page boundary — a
    split would render the surviving row as a pair with a missing partner.
    The field is bounded (100–200 runners), so we order + filter in memory
    rather than pushing dialect-specific SQL; only one page is serialized out.

    Returns (page_items, total_people_matching, page_count).
    """
    rows = list(
        db.scalars(
            select(Participant)
            .join(Race, Participant.race_id == Race.id)
            .where(Race.event_id == event_id)
            .order_by(Participant.bib, Participant.id)
        ).all()
    )
    if q:
        needle = q.strip().lower()
        rows = [
            p
            for p in rows
            if needle in f"{p.bib} {p.first_name} {p.last_name} {p.club or ''}".lower()
        ]

    # group consecutive rows sharing a (race, bib) into one entry (pair = one)
    groups: list[list[Participant]] = []
    for p in rows:
        if groups and groups[-1][0].race_id == p.race_id and groups[-1][0].bib == p.bib:
            groups[-1].append(p)
        else:
            groups.append([p])

    page_count = max(1, math.ceil(len(groups) / size))
    page = max(0, min(page, page_count - 1))
    window = groups[page * size : page * size + size]
    return [p for g in window for p in g], len(rows), page_count


def participants_with_bib(db: Session, event_id: int, bib: int) -> list[Participant]:
    return db.scalars(
        select(Participant)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id, Participant.bib == bib)
    ).all()


def assert_bib_available(
    db: Session,
    event_id: int,
    bib: int,
    *,
    race_id: int | None = None,
    pair_group: str | None = None,
    exclude_id: int | None = None,
) -> None:
    existing = [p for p in participants_with_bib(db, event_id, bib) if p.id != exclude_id]
    if not existing:
        return
    if (
        pair_group
        and len(existing) == 1
        and existing[0].race_id == race_id
        and existing[0].pair_group == pair_group
    ):
        return  # Paarlauf partner joining their pair
    raise BibConflictError(f"bib {bib} is already taken in this event")


def unpair_survivors(db: Session, participant: Participant) -> None:
    """Clear the pair_group of a deleted pair member's surviving partner.

    A Paarlauf pair is exactly two runners sharing a race + bib. When one is
    removed the other is no longer a pair, so drop its pair_group — otherwise it
    lingers as a pair with a missing partner (a false error in the UI and an
    empty Paarlauf category). Call before deleting `participant`.
    """
    if not participant.pair_group:
        return
    survivors = db.scalars(
        select(Participant).where(
            Participant.race_id == participant.race_id,
            Participant.bib == participant.bib,
            Participant.id != participant.id,
        )
    ).all()
    for p in survivors:
        p.pair_group = None


def next_free_bib(db: Session, event_id: int) -> int:
    """Next bib for day-of registration: highest existing bib + 1 (predictable
    while handing out numbers at a table; gaps are not reused)."""
    bibs = db.scalars(
        select(Participant.bib)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id)
    ).all()
    return (max(bibs) + 1) if bibs else 1
