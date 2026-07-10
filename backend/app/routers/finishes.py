"""Finish-line endpoints — accessible to both roles (timer and admin)."""

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DbDep, TimerUser
from app.models import Event, FinishRecord, FinishStatus, Participant, Race
from app.schemas import FinishIn, FinishOut, FinishPatch
from app.services.finishes import assign_bib, record_finish, void_finish

router = APIRouter(prefix="/api", tags=["finishes"])


def _finish_out(db: Session, record: FinishRecord, race: Race) -> FinishOut:
    out = FinishOut.model_validate(record)
    out.race_name = race.name
    if record.bib is not None:
        parts = db.scalars(
            select(Participant).where(
                Participant.race_id == record.race_id, Participant.bib == record.bib
            )
        ).all()
        if parts:
            out.participant_name = " & ".join(f"{p.first_name} {p.last_name}" for p in parts)
    if race.started_at is not None:
        out.elapsed_seconds = (record.recorded_at - race.started_at).total_seconds()
    return out


@router.post("/races/{race_id}/finishes", response_model=FinishOut, status_code=201)
def create_finish(race_id: int, body: FinishIn, db: DbDep, user: TimerUser, response: Response):
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    record, created = record_finish(
        db,
        race,
        client_id=body.client_id,
        bib=body.bib,
        recorded_at=body.recorded_at,
        created_by=user.username,
    )
    db.commit()
    if not created:
        response.status_code = 200  # idempotent replay
    return _finish_out(db, record, race)


@router.get("/races/{race_id}/finishes", response_model=list[FinishOut])
def list_finishes(race_id: int, db: DbDep, user: TimerUser, limit: int = 20):
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    records = db.scalars(
        select(FinishRecord)
        .where(FinishRecord.race_id == race_id)
        .order_by(FinishRecord.recorded_at.desc())
        .limit(limit)
    ).all()
    return [_finish_out(db, r, race) for r in records]


@router.get("/events/{event_id}/finishes", response_model=list[FinishOut])
def list_event_finishes(event_id: int, db: DbDep, user: TimerUser, limit: int = 20):
    """Recent finishes across ALL races of the event — the finish screen
    routes bibs to their race automatically, so its entry list spans races."""
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    races = {race.id: race for race in event.races}
    records = db.scalars(
        select(FinishRecord)
        .where(FinishRecord.race_id.in_(races.keys()))
        .order_by(FinishRecord.recorded_at.desc())
        .limit(limit)
    ).all()
    return [_finish_out(db, r, races[r.race_id]) for r in records]


@router.patch("/finishes/{finish_id}", response_model=FinishOut)
def patch_finish(finish_id: int, body: FinishPatch, db: DbDep, user: TimerUser):
    record = db.get(FinishRecord, finish_id)
    if record is None:
        raise HTTPException(status_code=404, detail="finish record not found")
    if body.status is not None:
        if body.status != FinishStatus.voided:
            raise HTTPException(
                status_code=422,
                detail="finish records are append-only; the only status change is 'voided'",
            )
        void_finish(record)
    if body.bib is not None:
        try:
            assign_bib(db, record, body.bib)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
    db.commit()
    race = db.get(Race, record.race_id)
    return _finish_out(db, record, race)
