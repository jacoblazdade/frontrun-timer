"""Bib allocation, event-wide bib uniqueness, and the Paarlauf gender rule.

Bibs are unique per EVENT (across its races). The single exception is a
Paarlauf group: two or more participants in the same race may share a bib if
they all share the same non-empty pair_group.
"""

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Gender, Participant, Race

# A Paarlauf group runs as a group and ranks only in "Paarlauf {race}", so the
# individual gender of its members never selects a category. Storing one value
# for every member keeps the data honest about that: a group is AllGender.
PAIR_GENDER = Gender.x


class BibConflictError(ValueError):
    pass


def pair_gender(data: dict, pair_group: str | None) -> dict:
    """Forces gender to AllGender when the participant is in a Paarlauf group.

    Applied on every write path (create, edit, import) so the rule holds no
    matter how the row got there. Leaving a group does NOT restore a previous
    gender — it is not recorded anywhere — so an ex-member stays AllGender
    until someone edits them.
    """
    if pair_group:
        data["gender"] = PAIR_GENDER
    return data


def list_event_participants(
    db: Session,
    event_id: int,
    *,
    q: str | None = None,
    page: int = 0,
    size: int = 50,
) -> tuple[list[Participant], int, int, int]:
    """Participants of an event ordered by bib, paginated for the admin table.

    Paging is by *entry*, not by row: a Paarlauf group (runners sharing a
    bib) counts as one entry and is never split across a page boundary — a
    split would render a group row with members missing.
    The field is bounded (100–200 runners), so we order + filter in memory
    rather than pushing dialect-specific SQL; only one page is serialized out.

    Returns (page_items, total_people_matching, page_count, registered_total).
    `registered_total` counts the whole event, not the page or the search hits:
    "how many have turned up" is a question about the event.
    """
    rows = list(
        db.scalars(
            select(Participant)
            .join(Race, Participant.race_id == Race.id)
            .where(Race.event_id == event_id)
            .order_by(Participant.bib, Participant.id)
        ).all()
    )
    registered_total = sum(1 for p in rows if p.registered)
    if q:
        needle = q.strip().lower()
        rows = [
            p
            for p in rows
            if needle in f"{p.bib} {p.first_name} {p.last_name} {p.club or ''}".lower()
        ]

    # group consecutive rows sharing a (race, bib) into one entry (group = one)
    groups: list[list[Participant]] = []
    for p in rows:
        if groups and groups[-1][0].race_id == p.race_id and groups[-1][0].bib == p.bib:
            groups[-1].append(p)
        else:
            groups.append([p])

    page_count = max(1, math.ceil(len(groups) / size))
    page = max(0, min(page, page_count - 1))
    window = groups[page * size : page * size + size]
    return [p for g in window for p in g], len(rows), page_count, registered_total


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
    if pair_group and all(
        p.race_id == race_id and p.pair_group == pair_group for p in existing
    ):
        return  # Paarlauf runner joining their group (any size) in the same race
    raise BibConflictError(f"bib {bib} is already taken in this event")


def unpair_survivors(db: Session, participant: Participant) -> None:
    """Dissolve a Paarlauf group that a deletion has shrunk to a lone runner.

    A Paarlauf group is two or more runners sharing a race + bib. Removing one
    member may leave the rest as a smaller (still valid) group, or — if only one
    remains — a lone runner who is no longer a group, so we clear that runner's
    pair_group. Otherwise it lingers as a group with a missing partner (a false
    error in the UI and a one-runner Paarlauf place). Call before deleting
    `participant`.
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
    if len(survivors) == 1:
        survivors[0].pair_group = None


def next_free_bib(db: Session, event_id: int) -> int:
    """Next bib for day-of registration: highest existing bib + 1 (predictable
    while handing out numbers at a table; gaps are not reused)."""
    bibs = db.scalars(
        select(Participant.bib)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id)
    ).all()
    return (max(bibs) + 1) if bibs else 1
