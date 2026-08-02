"""Finish-line endpoints — accessible to both roles (timer and admin)."""

from collections.abc import Iterable

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import DbDep, TimerUser
from app.models import Event, FinishRecord, FinishStatus, Participant, Race
from app.schemas import BibTargetOut, EventOut, FinishIn, FinishOut, FinishPatch
from app.services.finishes import assign_bib, record_finish, restore_finish, void_finish

router = APIRouter(prefix="/api", tags=["finishes"])

# The finish lists are meant to be read whole (an event has 100-200 runners);
# this is only a guard against a runaway query.
MAX_LIMIT = 5000


@router.get("/timer/events", response_model=list[EventOut])
def timer_events(db: DbDep, user: TimerUser):
    """All events with their races — timer-accessible so the finish screen's
    event/race selector and clock work even for unpublished events."""
    return db.scalars(select(Event).order_by(Event.date.desc())).all()


@router.get("/events/{event_id}/bibs", response_model=list[BibTargetOut])
def list_event_bibs(event_id: int, db: DbDep, user: TimerUser):
    """bib -> race + runner name for the whole event, so the finish screen can
    route each bib to its runner's race (works offline once prefetched)."""
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    race_names = {race.id: race.name for race in event.races}
    parts = db.scalars(
        select(Participant)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id)
        .order_by(Participant.bib)
    ).all()
    by_bib: dict[int, BibTargetOut] = {}
    for p in parts:
        name = f"{p.first_name} {p.last_name}"
        if p.bib in by_bib:
            by_bib[p.bib].name += f" & {name}"  # Paarlauf group shares a bib
        else:
            by_bib[p.bib] = BibTargetOut(
                bib=p.bib,
                race_id=p.race_id,
                race_name=race_names.get(p.race_id, ""),
                name=name,
            )
    return list(by_bib.values())


def _names_by_bib(db: Session, race_ids: Iterable[int]) -> dict[tuple[int, int], str]:
    """(race_id, bib) -> runner name(s), in one query. The finish lists are
    shown in full (hundreds of rows), so names must not cost a query each."""
    names: dict[tuple[int, int], str] = {}
    parts = db.scalars(select(Participant).where(Participant.race_id.in_(list(race_ids)))).all()
    for p in parts:
        key = (p.race_id, p.bib)
        name = f"{p.first_name} {p.last_name}"
        names[key] = f"{names[key]} & {name}" if key in names else name  # Paarlauf group
    return names


def _finish_out(
    db: Session,
    record: FinishRecord,
    race: Race,
    names: dict[tuple[int, int], str] | None = None,
) -> FinishOut:
    out = FinishOut.model_validate(record)
    out.race_name = race.name
    if record.bib is not None:
        if names is None:
            names = _names_by_bib(db, [record.race_id])
        out.participant_name = names.get((record.race_id, record.bib))
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
def list_finishes(
    race_id: int, db: DbDep, user: TimerUser, limit: int = Query(20, ge=1, le=MAX_LIMIT)
):
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    records = db.scalars(
        select(FinishRecord)
        .where(FinishRecord.race_id == race_id)
        .order_by(FinishRecord.recorded_at.desc())
        .limit(limit)
    ).all()
    names = _names_by_bib(db, [race_id])
    return [_finish_out(db, r, race, names) for r in records]


@router.get("/events/{event_id}/finishes", response_model=list[FinishOut])
def list_event_finishes(
    event_id: int, db: DbDep, user: TimerUser, limit: int = Query(20, ge=1, le=MAX_LIMIT)
):
    """Finishes across ALL races of the event, newest first — the finish screen
    routes bibs to their race automatically, so its entry list spans races.

    The admin lists ask for the whole event (a few hundred rows at most): both
    the finish screen and the assign/conflict screen are worked through as one
    list, so `limit` exists only as a sanity bound, not as paging.
    """
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
    names = _names_by_bib(db, races.keys())
    return [_finish_out(db, r, races[r.race_id], names) for r in records]


@router.patch("/finishes/{finish_id}", response_model=FinishOut)
def patch_finish(finish_id: int, body: FinishPatch, db: DbDep, user: TimerUser):
    record = db.get(FinishRecord, finish_id)
    if record is None:
        raise HTTPException(status_code=404, detail="finish record not found")
    if body.status is not None:
        # Append-only: the deliberate transitions are void (undo a finish) and
        # its reverse, restore (undo the deletion). Any explicit non-voided
        # status is treated as "restore" — the real ok/conflict/unassigned
        # value is recomputed so restoring never overwrites another record.
        if body.status == FinishStatus.voided:
            void_finish(record)
        else:
            restore_finish(db, record)
    if body.bib is not None:
        try:
            assign_bib(db, record, body.bib)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
    db.commit()
    race = db.get(Race, record.race_id)
    return _finish_out(db, record, race)
