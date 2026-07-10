"""Admin event endpoints: full event list, publish flag, participant import,
next free bib, XLSX export."""

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.deps import DbDep, require_admin
from app.models import Event, Participant, Race, RaceStatus, utcnow
from app.schemas import EventCreate, EventOut, EventPatch, ImportReport, ImportRowError
from app.services.exporter import results_workbook
from app.services.importer import import_participants, parse_table
from app.services.participants import next_free_bib
from app.services.ranking import event_results

router = APIRouter(prefix="/api", tags=["admin-events"], dependencies=[Depends(require_admin)])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _get_event(db: Session, event_id: int) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return event


@router.get("/admin/events", response_model=list[EventOut])
def list_all_events(db: DbDep):
    return db.scalars(select(Event).order_by(Event.date.desc())).all()


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: EventCreate, db: DbDep):
    """Next year's event: created unpublished, with its races."""
    event = Event(name=body.name, date=body.date, is_published=False)
    db.add(event)
    db.flush()
    for race_name in body.races:
        if race_name.strip():
            db.add(Race(event_id=event.id, name=race_name.strip()))
    db.commit()
    db.refresh(event)
    return event


@router.post("/events/{event_id}/start-races", response_model=EventOut)
def start_all_races(event_id: int, db: DbDep):
    """Starts every not-yet-started race of the event with ONE shared
    timestamp — at Frontrun both races go off on the same gun."""
    event = _get_event(db, event_id)
    now = utcnow()
    started = 0
    for race in event.races:
        if race.started_at is None:
            race.started_at = now
            race.status = RaceStatus.running
            race.updated_at = now
            started += 1
    if started == 0:
        raise HTTPException(status_code=409, detail="all races have already started")
    db.commit()
    db.refresh(event)
    return event


@router.patch("/events/{event_id}", response_model=EventOut)
def patch_event(event_id: int, body: EventPatch, db: DbDep):
    event = _get_event(db, event_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    db.commit()
    return event


@router.delete("/events/{event_id}/participants")
def clear_participants(event_id: int, db: DbDep):
    """Deletes ALL participants of the event (every race) — for re-importing
    a fresh registration list. Finish records are untouched; their bibs just
    stop resolving to a name until participants exist again."""
    _get_event(db, event_id)
    race_ids = select(Race.id).where(Race.event_id == event_id)
    result = db.execute(delete(Participant).where(Participant.race_id.in_(race_ids)))
    db.commit()
    return {"deleted": result.rowcount}


@router.get("/events/{event_id}/next-bib")
def get_next_bib(event_id: int, db: DbDep):
    _get_event(db, event_id)
    return {"next_bib": next_free_bib(db, event_id)}


@router.post("/events/{event_id}/import", response_model=ImportReport)
def import_event_participants(
    event_id: int,
    db: DbDep,
    file: UploadFile = File(...),
    mapping: str = Form(...),  # JSON: {"bib": "Startnr", "first_name": "Vorname", ...}
    dry_run: bool = Form(True),
    default_race_id: int | None = Form(None),
):
    event = _get_event(db, event_id)
    try:
        mapping_dict = json.loads(mapping)
        if not isinstance(mapping_dict, dict):
            raise ValueError
    except ValueError as e:
        raise HTTPException(status_code=422, detail="mapping must be a JSON object") from e

    content = file.file.read()
    try:
        rows = parse_table(file.filename or "upload.csv", content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"could not parse file: {e}") from e

    result = import_participants(
        db,
        event,
        rows=rows,
        mapping=mapping_dict,
        default_race_id=default_race_id,
        dry_run=dry_run,
    )
    if result.committed:
        db.commit()
    else:
        db.rollback()
    return ImportReport(
        total_rows=result.total_rows,
        valid_rows=result.valid_rows,
        errors=[ImportRowError(row=e.row, message=e.message) for e in result.errors],
        dropped_columns=result.dropped_columns,
        columns=result.columns,
        created=result.created,
        committed=result.committed,
    )


@router.get("/events/{event_id}/export.xlsx")
def export_results(event_id: int, db: DbDep):
    event = _get_event(db, event_id)
    _, rows = event_results(db, event)
    filename = f"{event.name.replace(' ', '_')}_results.xlsx"
    return Response(
        content=results_workbook(rows),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
