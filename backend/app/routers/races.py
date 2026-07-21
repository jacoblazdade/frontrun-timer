"""Race control — admin only. The timer role handles finishes only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.deps import DbDep, require_admin
from app.models import FinishRecord, Race, RaceStatus, utcnow
from app.schemas import RaceOut, RacePatch

router = APIRouter(
    prefix="/api/races", tags=["races"], dependencies=[Depends(require_admin)]
)


def _get_race(db: Session, race_id: int) -> Race:
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    return race


@router.post("/{race_id}/start", response_model=RaceOut)
def start_race(race_id: int, db: DbDep):
    race = _get_race(db, race_id)
    if race.started_at is not None:
        raise HTTPException(
            status_code=409,
            detail="race already started; PATCH started_at to correct the start time",
        )
    race.started_at = utcnow()
    race.status = RaceStatus.running
    race.updated_at = utcnow()
    db.commit()
    return race


@router.delete("/{race_id}/finishes")
def clear_finishes(race_id: int, db: DbDep):
    """Deletes ALL finish records of a race — the one deliberate exception to
    the append-only rule, for wiping test entries or recovering from a false
    start. Admin only; individual records still can only be voided."""
    race = _get_race(db, race_id)
    result = db.execute(delete(FinishRecord).where(FinishRecord.race_id == race_id))
    race.updated_at = utcnow()
    db.commit()
    return {"deleted": result.rowcount}


@router.delete("/{race_id}", status_code=204)
def delete_race(race_id: int, db: DbDep):
    """Deletes an (empty) race. Refused with 409 while the race still holds
    participants or finish records — clear those first so nothing precious is
    lost by accident. This is the way to remove a race created in error."""
    race = _get_race(db, race_id)
    if race.participant_count > 0 or race.finish_count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "race still has participants or finishes; remove them first "
                "(Teilnehmer löschen / Ergebnisse löschen), then delete the race"
            ),
        )
    db.delete(race)
    db.commit()


@router.patch("/{race_id}", response_model=RaceOut)
def patch_race(race_id: int, body: RacePatch, db: DbDep):
    race = _get_race(db, race_id)
    data = body.model_dump(exclude_unset=True)
    if "started_at" in data:
        race.started_at = data["started_at"]
    if data.get("status") is not None:
        race.status = data["status"]
    # bump updated_at so result pollers (`since=`) refetch: elapsed times may
    # have changed retroactively via a start-time correction
    race.updated_at = utcnow()
    db.commit()
    return race
