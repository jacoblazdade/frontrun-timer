"""Participant CRUD — admin only.

Every field is editable through PATCH, including the race and the source. The
rules that can't live in the schema are enforced here and answered with a 409
that names what is in the way (the admin table shows the message inline):

- a bib is unique per EVENT, so a participant can never be moved to a race of
  another event, and a bib already handed out is refused;
- a Paarlauf group is "same race + same bib + same group", so a member can't
  wander off to another race, or drop out of the group, while still sharing
  the bib — give them a free bib in the same edit instead.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import DbDep, require_admin
from app.models import Event, Participant, Race
from app.schemas import ParticipantIn, ParticipantOut, ParticipantPage, ParticipantPatch
from app.services.participants import (
    BibConflictError,
    assert_bib_available,
    list_event_participants,
    pair_gender,
    participants_with_bib,
    unpair_survivors,
)

router = APIRouter(prefix="/api", tags=["participants"], dependencies=[Depends(require_admin)])

# fields that are plain text and should be stored trimmed, with "" meaning
# "not set" for the optional ones
_TEXT_FIELDS = ("first_name", "last_name", "club", "pair_group")
_OPTIONAL_TEXT = ("club", "pair_group")


def _clean(data: dict) -> dict:
    """Trims text fields; blanks out optional ones that came in empty."""
    for key in _TEXT_FIELDS:
        value = data.get(key)
        if isinstance(value, str):
            value = value.strip()
            if not value:
                if key not in _OPTIONAL_TEXT:
                    raise HTTPException(status_code=422, detail=f"{key} must not be empty")
                value = None
            data[key] = value
    return data


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
    items, total, page_count, registered_total = list_event_participants(
        db, event_id, q=q, page=page, size=size
    )
    return ParticipantPage(
        items=items,
        total=total,
        page=min(page, page_count - 1),
        page_count=page_count,
        registered_total=registered_total,
    )


@router.post("/participants", response_model=ParticipantOut, status_code=201)
def create_participant(body: ParticipantIn, db: DbDep):
    race = db.get(Race, body.race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    data = _clean(body.model_dump())
    data = pair_gender(data, data["pair_group"])  # a group always runs AllGender
    try:
        assert_bib_available(
            db, race.event_id, data["bib"], race_id=race.id, pair_group=data["pair_group"]
        )
    except BibConflictError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    participant = Participant(**data)
    db.add(participant)
    db.commit()
    return participant


@router.patch("/participants/{participant_id}", response_model=ParticipantOut)
def update_participant(participant_id: int, body: ParticipantPatch, db: DbDep):
    participant = db.get(Participant, participant_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="participant not found")
    data = _clean(body.model_dump(exclude_unset=True))

    old_race = db.get(Race, participant.race_id)
    race_id = data.get("race_id", participant.race_id)
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    # bibs are unique per event, so a move across events would silently take a
    # bib out of the namespace that guards it
    if race.event_id != old_race.event_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"race '{race.name}' belongs to another event; "
                "a participant cannot change event"
            ),
        )

    bib = data.get("bib", participant.bib)
    pair_group = data.get("pair_group", participant.pair_group)
    # AllGender applies whether the group was joined in this edit or was
    # already there — which also heals members created before the rule
    data = pair_gender(data, pair_group)
    # leaving the group behind (new bib, new race, or no group any more) may
    # shrink it to a single runner, who is then no longer a group at all
    leaving = participant.pair_group is not None and (
        bib != participant.bib or race_id != participant.race_id or pair_group is None
    )
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
        raise HTTPException(
            status_code=409,
            detail=_bib_conflict_detail(db, participant, race, bib, pair_group),
        ) from e

    if leaving:
        unpair_survivors(db, participant)
    for key, value in data.items():
        setattr(participant, key, value)
    db.commit()
    return participant


def _bib_conflict_detail(
    db: Session,
    participant: Participant,
    race: Race,
    bib: int,
    pair_group: str | None,
) -> str:
    """Explains *who* is in the way, so the admin table can say something more
    useful than 'bib is taken'."""
    blockers = [
        p for p in participants_with_bib(db, race.event_id, bib) if p.id != participant.id
    ]
    own_group = [
        p
        for p in blockers
        if p.race_id == participant.race_id
        and participant.pair_group is not None
        and p.pair_group == participant.pair_group
    ]
    if own_group and len(own_group) == len(blockers):
        names = ", ".join(f"{p.first_name} {p.last_name}" for p in own_group)
        if pair_group is None:
            return (
                f"bib {bib} is shared with the Paarlauf group ({names}); "
                "give this runner a free bib in the same edit to leave the group"
            )
        return (
            f"bib {bib} is shared with the Paarlauf group ({names}) in another race; "
            "move the whole group or give this runner a free bib"
        )
    names = ", ".join(f"{p.first_name} {p.last_name}" for p in blockers)
    return f"bib {bib} is already taken in this event by {names}"


@router.delete("/participants/{participant_id}", status_code=204)
def delete_participant(participant_id: int, db: DbDep):
    participant = db.get(Participant, participant_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="participant not found")
    unpair_survivors(db, participant)
    db.delete(participant)
    db.commit()
