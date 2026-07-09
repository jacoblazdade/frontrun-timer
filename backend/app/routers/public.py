"""Public endpoints — no auth. Results are only visible once the event is
published; the bib lookup for the announcer works regardless."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.deps import DbDep
from app.models import Event, Participant, Race, utcnow
from app.schemas import EventOut, LookupOut, ResultRowOut, ResultsOut
from app.services.ranking import event_results, format_elapsed

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/events", response_model=list[EventOut])
def list_events(db: DbDep):
    return db.scalars(
        select(Event).where(Event.is_published.is_(True)).order_by(Event.date.desc())
    ).all()


@router.get("/events/{event_id}/results", response_model=ResultsOut)
def get_results(
    event_id: int,
    db: DbDep,
    category: str | None = None,
    since: datetime | None = None,
):
    event = db.get(Event, event_id)
    if event is None or not event.is_published:
        raise HTTPException(status_code=404, detail="event not found")
    if since is not None and since.tzinfo is None:
        since = since.replace(tzinfo=UTC)
    categories, rows = event_results(db, event, category=category, since=since)
    return ResultsOut(
        event_id=event.id,
        categories=categories,
        results=[
            ResultRowOut(
                category=r.category,
                rank=r.rank,
                bib=r.bib,
                name=r.name,
                birth_year=r.birth_year,
                club=r.club,
                elapsed_seconds=r.elapsed_seconds,
                time=format_elapsed(r.elapsed_seconds),
                changed_at=r.changed_at,
            )
            for r in rows
        ],
        server_time=utcnow(),
    )


@router.get("/races/{race_id}/lookup", response_model=LookupOut)
def lookup_bib(race_id: int, bib: int, db: DbDep):
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status_code=404, detail="race not found")
    parts = db.scalars(
        select(Participant).where(Participant.race_id == race_id, Participant.bib == bib)
    ).all()
    if not parts:
        raise HTTPException(status_code=404, detail="bib not found in this race")
    name = " & ".join(f"{p.first_name} {p.last_name}" for p in parts)
    return LookupOut(bib=bib, name=name, club=parts[0].club)
