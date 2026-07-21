"""Finish record logic.

Append-only: undo = status 'voided', never delete. A second finish for a bib
that already has an ok record becomes a 'conflict' — it never overwrites.
Creation is idempotent by client_id so the offline outbox can replay safely.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FinishRecord, FinishStatus, Race


def _status_for(
    db: Session, race_id: int, bib: int | None, exclude_id: int | None = None
) -> FinishStatus:
    if bib is None:
        return FinishStatus.unassigned
    q = select(FinishRecord.id).where(
        FinishRecord.race_id == race_id,
        FinishRecord.bib == bib,
        FinishRecord.status == FinishStatus.ok,
    )
    if exclude_id is not None:
        q = q.where(FinishRecord.id != exclude_id)
    has_ok = db.scalars(q.limit(1)).first() is not None
    return FinishStatus.conflict if has_ok else FinishStatus.ok


def record_finish(
    db: Session,
    race: Race,
    *,
    client_id: str,
    bib: int | None,
    recorded_at: datetime,
    created_by: str,
) -> tuple[FinishRecord, bool]:
    """Idempotent by client_id: replaying the same tap returns the stored
    record unchanged. Returns (record, created)."""
    existing = db.scalar(select(FinishRecord).where(FinishRecord.client_id == client_id))
    if existing is not None:
        return existing, False
    record = FinishRecord(
        race_id=race.id,
        bib=bib,
        recorded_at=recorded_at,
        client_id=client_id,
        status=_status_for(db, race.id, bib),
        created_by=created_by,
    )
    db.add(record)
    db.flush()
    return record, True


def void_finish(record: FinishRecord) -> FinishRecord:
    record.status = FinishStatus.voided
    return record


def restore_finish(db: Session, record: FinishRecord) -> FinishRecord:
    """Undo a void: bring a voided record back to life. The correct status is
    recomputed from its bib (unassigned if it has none, conflict if the bib
    already has an ok finish, else ok) — un-voiding never overwrites another
    record. No-op on records that are not voided."""
    if record.status != FinishStatus.voided:
        return record
    record.status = _status_for(db, record.race_id, record.bib, exclude_id=record.id)
    return record


def assign_bib(db: Session, record: FinishRecord, bib: int) -> FinishRecord:
    """Assign/correct the bib of an unassigned or conflict record.

    Re-routes the record to the bib's own race — bibs are unique per event, so
    the bib determines the race — and re-evaluates ok/conflict there. Elapsed
    time is always derived from the race start, so moving races corrects the
    time as well. This is why the finish screen needs no race picker for empty
    or unknown taps: the race is settled here, when the bib is assigned. An
    unknown bib (no such participant in the event) keeps the current race.
    """
    from app.services.participants import participants_with_bib

    if record.status == FinishStatus.voided:
        raise ValueError("cannot assign a bib to a voided record")
    race = db.get(Race, record.race_id)
    owners = participants_with_bib(db, race.event_id, bib)
    if owners:
        record.race_id = owners[0].race_id
    record.bib = bib
    record.status = _status_for(db, record.race_id, bib, exclude_id=record.id)
    return record
