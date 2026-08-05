"""Admin event endpoints: full event list, publish flag, participant import,
next free bib, XLSX export."""

import json
import re
import unicodedata

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.deps import AdminUser, DbDep, require_admin
from app.models import Event, FinishRecord, Participant, Race, RaceStatus, utcnow
from app.schemas import (
    EventCreate,
    EventOut,
    EventPatch,
    ImportReport,
    ImportRowError,
    ResultsImportReport,
)
from app.services.exporter import participants_workbook, results_workbook
from app.services.importer import import_participants, parse_table
from app.services.participants import next_free_bib
from app.services.ranking import event_results
from app.services.results_import import REPLACE, import_results

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


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, db: DbDep):
    """Deletes an event and its (empty) races — the way to remove a stray event
    or an empty shell left in the list. Refused with 409 while any race still
    holds participants or finish records, so nothing precious is lost by
    accident (clear those first)."""
    event = _get_event(db, event_id)
    race_ids = [r.id for r in event.races]
    if race_ids:
        has_parts = db.scalar(
            select(Participant.id).where(Participant.race_id.in_(race_ids)).limit(1)
        )
        has_finishes = db.scalar(
            select(FinishRecord.id).where(FinishRecord.race_id.in_(race_ids)).limit(1)
        )
        if has_parts or has_finishes:
            raise HTTPException(
                status_code=409,
                detail=(
                    "event still has participants or finishes; remove them first, "
                    "then delete the event"
                ),
            )
        db.execute(delete(Race).where(Race.event_id == event_id))
    db.delete(event)
    db.commit()


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


def _read_upload(file: UploadFile, mapping: str) -> tuple[list[dict[str, str]], dict[str, str]]:
    """Shared multipart handling for the two importers: a JSON column mapping
    plus the uploaded table parsed into rows."""
    try:
        mapping_dict = json.loads(mapping)
        if not isinstance(mapping_dict, dict):
            raise ValueError
    except ValueError as e:
        raise HTTPException(status_code=422, detail="mapping must be a JSON object") from e

    try:
        rows = parse_table(file.filename or "upload.csv", file.file.read())
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"could not parse file: {e}") from e
    return rows, mapping_dict


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
    rows, mapping_dict = _read_upload(file, mapping)

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


@router.post("/events/{event_id}/import-results", response_model=ResultsImportReport)
def import_event_results(
    event_id: int,
    db: DbDep,
    user: AdminUser,
    file: UploadFile = File(...),
    mapping: str = Form(...),  # JSON: {"bib": "Startnr.", "time": "Zeit"}
    mode: str = Form(REPLACE),  # 'replace' (file wins) or 'merge' (add only)
    dry_run: bool = Form(True),
):
    """Fallback path: take the finish list from the Excel workbook the club
    falls back to when the app has problems, and make it what the app shows.

    Times are net running times; they are converted to finish records against
    each race's start (elapsed time is never stored). 'replace' voids — never
    deletes — the existing finishes of every race the file touches.
    """
    event = _get_event(db, event_id)
    rows, mapping_dict = _read_upload(file, mapping)

    result = import_results(
        db,
        event,
        rows=rows,
        mapping=mapping_dict,
        mode=mode,
        created_by=user.username,
        dry_run=dry_run,
    )
    if result.committed:
        db.commit()
    else:
        db.rollback()
    return ResultsImportReport(
        total_rows=result.total_rows,
        valid_rows=result.valid_rows,
        errors=[ImportRowError(row=e.row, message=e.message) for e in result.errors],
        dropped_columns=result.dropped_columns,
        columns=result.columns,
        races=result.races,
        started_races=result.started_races,
        voided=result.voided,
        created=result.created,
        committed=result.committed,
    )


def _download(content: bytes, event: Event, suffix: str) -> Response:
    # Content-Disposition is encoded latin-1, so strip the filename to ASCII
    # instead of risking an UnicodeEncodeError on an event name.
    slug = re.sub(r"[^A-Za-z0-9]+", "_", unicodedata.normalize("NFKD", event.name)).strip("_")
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{slug or "event"}_{suffix}.xlsx"'},
    )


@router.get("/events/{event_id}/export.xlsx")
def export_results(event_id: int, db: DbDep):
    event = _get_event(db, event_id)
    _, rows = event_results(db, event)
    return _download(results_workbook(rows), event, "results")


@router.get("/events/{event_id}/participants.xlsx")
def export_participants(event_id: int, db: DbDep):
    """The event's complete participant list (all races), ordered by bib like
    the admin table. Columns match the importer's, so the file can be edited
    and imported back."""
    event = _get_event(db, event_id)
    participants = list(
        db.scalars(
            select(Participant)
            .join(Race, Participant.race_id == Race.id)
            .where(Race.event_id == event_id)
            .order_by(Participant.bib, Participant.id)
        ).all()
    )
    race_names = {race.id: race.name for race in event.races}
    return _download(participants_workbook(participants, race_names), event, "teilnehmer")
