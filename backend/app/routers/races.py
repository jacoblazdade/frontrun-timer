"""Race control — admin only. The timer role handles finishes only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import DbDep, require_admin
from app.models import Race, RaceStatus, utcnow
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
