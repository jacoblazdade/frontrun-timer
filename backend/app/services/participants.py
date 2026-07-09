"""Bib allocation and event-wide bib uniqueness.

Bibs are unique per EVENT (across its races). The single exception is a
Paarlauf pair: exactly two participants in the same race may share a bib if
they share the same non-empty pair_group.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Participant, Race


class BibConflictError(ValueError):
    pass


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


def next_free_bib(db: Session, event_id: int) -> int:
    """Next bib for day-of registration: highest existing bib + 1 (predictable
    while handing out numbers at a table; gaps are not reused)."""
    bibs = db.scalars(
        select(Participant.bib)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id)
    ).all()
    return (max(bibs) + 1) if bibs else 1
