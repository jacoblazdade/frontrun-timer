"""Participant CRUD — admin only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.deps import DbDep, require_admin
from app.models import Event, Participant, Race
from app.schemas import ParticipantIn, ParticipantOut, ParticipantPatch
from app.services.participants import BibConflictError, assert_bib_available

router = APIRouter(prefix="/api", tags=["participants"], dependencies=[Depends(require_admin)])


@router.get("/events/{event_id}/participants", response_model=list[ParticipantOut])
def list_participants(event_id: int, db: DbDep):
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return db.scalars(
        select(Participant)
        .join(Race, Participant.race_id == Race.id)
        .where(Race.event_id == event_id)
        .order_by(Participant.bib)
    ).all()


@router.post("/participants", response_model=ParticipantOut, status_code=201)
def create_participant(body: ParticipantIn, db: DbDep):
    race = db.get(Race, body.race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    try:
        assert_bib_available(
            db, race.event_id, body.bib, race_id=race.id, pair_group=body.pair_group
        )
    except BibConflictError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    participant = Participant(**body.model_dump())
    db.add(participant)
    db.commit()
    return participant


@router.patch("/participants/{participant_id}", response_model=ParticipantOut)
def update_participant(participant_id: int, body: ParticipantPatch, db: DbDep):
    participant = db.get(Participant, participant_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="participant not found")
    data = body.model_dump(exclude_unset=True)

    race_id = data.get("race_id", participant.race_id)
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    bib = data.get("bib", participant.bib)
    pair_group = data.get("pair_group", participant.pair_group)
    try:
        assert_bib_available(
            db,
            race.event_id,
            bib,
            race_id=race_id,
            pair_group=pair_group,
            exclude_id=participant.id,
        )
    except BibConflictError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    for key, value in data.items():
        setattr(participant, key, value)
    db.commit()
    return participant


@router.delete("/participants/{participant_id}", status_code=204)
def delete_participant(participant_id: int, db: DbDep):
    participant = db.get(Participant, participant_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="participant not found")
    db.delete(participant)
    db.commit()
