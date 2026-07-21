"""Participant CRUD — admin only."""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import DbDep, require_admin
from app.models import Event, Participant, Race
from app.schemas import ParticipantIn, ParticipantOut, ParticipantPage, ParticipantPatch
from app.services.participants import (
    BibConflictError,
    assert_bib_available,
    list_event_participants,
    unpair_survivors,
)

router = APIRouter(prefix="/api", tags=["participants"], dependencies=[Depends(require_admin)])


@router.get("/events/{event_id}/participants", response_model=ParticipantPage)
def list_participants(
    event_id: int,
    db: DbDep,
    q: str | None = None,
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=200),
):
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    items, total, page_count = list_event_participants(
        db, event_id, q=q, page=page, size=size
    )
    return ParticipantPage(
        items=items, total=total, page=min(page, page_count - 1), page_count=page_count
    )


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
    unpair_survivors(db, participant)
    db.delete(participant)
    db.commit()
