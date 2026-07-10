from datetime import date, datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.models import FinishStatus, Gender, ParticipantSource, RaceStatus, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(ORMModel):
    id: int
    username: str
    role: Role


# ---- events / races ----


class RaceOut(ORMModel):
    id: int
    event_id: int
    name: str
    status: RaceStatus
    started_at: datetime | None


class EventOut(ORMModel):
    id: int
    name: str
    date: date
    is_published: bool
    races: list[RaceOut] = []


class RacePatch(BaseModel):
    started_at: AwareDatetime | None = None
    status: RaceStatus | None = None


class EventPatch(BaseModel):
    name: str | None = None
    is_published: bool | None = None


class EventCreate(BaseModel):
    name: str = Field(min_length=1)
    date: date
    races: list[str] = ["5 km", "10 km"]


# ---- participants ----


class ParticipantBase(BaseModel):
    bib: int = Field(ge=1)
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    gender: Gender
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    club: str | None = None
    pair_group: str | None = None


class ParticipantIn(ParticipantBase):
    race_id: int
    source: ParticipantSource = ParticipantSource.day_of


class ParticipantPatch(BaseModel):
    race_id: int | None = None
    bib: int | None = Field(default=None, ge=1)
    first_name: str | None = None
    last_name: str | None = None
    gender: Gender | None = None
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    club: str | None = None
    pair_group: str | None = None


class ParticipantOut(ORMModel, ParticipantBase):
    id: int
    race_id: int
    source: ParticipantSource


# ---- finishes ----


class FinishIn(BaseModel):
    client_id: str = Field(min_length=8, max_length=36)
    bib: int | None = Field(default=None, ge=1)
    recorded_at: AwareDatetime


class FinishPatch(BaseModel):
    # status: only 'voided' is accepted (undo) — records are append-only.
    status: FinishStatus | None = None
    # bib: assign/correct the bib of an unassigned or conflict record.
    bib: int | None = Field(default=None, ge=1)


class FinishOut(ORMModel):
    id: int
    race_id: int
    race_name: str | None = None
    bib: int | None
    recorded_at: datetime
    client_id: str
    status: FinishStatus
    created_by: str
    participant_name: str | None = None
    elapsed_seconds: float | None = None


# ---- results ----


class ResultRowOut(BaseModel):
    category: str
    rank: int
    bib: int
    name: str
    birth_year: int | None
    club: str | None
    elapsed_seconds: float
    time: str
    changed_at: datetime


class ResultsOut(BaseModel):
    event_id: int
    categories: list[str]
    results: list[ResultRowOut]
    # clients use this as the `since` cursor for the next poll
    server_time: datetime


class LookupOut(BaseModel):
    bib: int
    name: str
    club: str | None = None


class BibTargetOut(BaseModel):
    # one entry per bib (Paarlauf partners are merged into one name), so the
    # finish screen can route a typed bib to its runner's race
    bib: int
    race_id: int
    race_name: str
    name: str


# ---- import ----


class ImportRowError(BaseModel):
    row: int
    message: str


class ImportReport(BaseModel):
    total_rows: int
    valid_rows: int
    errors: list[ImportRowError]
    dropped_columns: list[str]
    columns: list[str]
    created: int
    committed: bool
