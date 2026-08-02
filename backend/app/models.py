"""SQLAlchemy models.

Portability: everything here must work on both SQLite (dev/tests) and
Postgres (production). Enums are stored as plain strings (native_enum=False),
datetimes as timezone-aware UTC via UTCDateTime.

Elapsed time is NEVER stored — it is always derived as
finish.recorded_at − race.started_at, so correcting a start time
retroactively fixes every result.
"""

from __future__ import annotations

import enum
from datetime import UTC, datetime
from datetime import date as date_type

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    TypeDecorator,
    func,
    select,
)
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Stores tz-aware datetimes as UTC; returns tz-aware UTC on both backends
    (SQLite drops tzinfo on read, so it is re-attached here)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetimes are not allowed; pass tz-aware UTC")
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


def str_enum(e: type[enum.Enum]) -> Enum:
    return Enum(e, native_enum=False, length=20, values_callable=lambda x: [m.value for m in x])


class Role(enum.StrEnum):
    admin = "admin"
    timer = "timer"


class RaceStatus(enum.StrEnum):
    pending = "pending"
    running = "running"
    finished = "finished"


class Gender(enum.StrEnum):
    m = "m"
    w = "w"
    x = "x"


class ParticipantSource(enum.StrEnum):
    imported = "import"
    day_of = "day_of"


class FinishStatus(enum.StrEnum):
    """The spec's ok/unassigned/voided plus 'conflict': a finish for a bib
    that already has an ok finish is kept as a conflict to resolve manually —
    it must never overwrite the existing record."""

    ok = "ok"
    unassigned = "unassigned"
    voided = "voided"
    conflict = "conflict"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(str_enum(Role), default=Role.timer)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    date: Mapped[date_type] = mapped_column(Date)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)

    races: Mapped[list[Race]] = relationship(back_populates="event", order_by="Race.id")


class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(50))
    status: Mapped[RaceStatus] = mapped_column(str_enum(RaceStatus), default=RaceStatus.pending)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # bumped on any change so result polling (`since=`) picks up start-time corrections
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    event: Mapped[Event] = relationship(back_populates="races")
    participants: Mapped[list[Participant]] = relationship(back_populates="race")
    finishes: Mapped[list[FinishRecord]] = relationship(back_populates="race")


class Participant(Base):
    __tablename__ = "participants"
    # NOTE: no email column, on purpose — emails must never be stored
    # (the importer drops email columns silently).

    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    bib: Mapped[int] = mapped_column(Integer, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    gender: Mapped[Gender] = mapped_column(str_enum(Gender))
    birth_year: Mapped[int | None] = mapped_column(Integer, default=None)
    club: Mapped[str | None] = mapped_column(String(100), default=None)
    # Paarlauf group members share bib and pair_group and rank as one place.
    pair_group: Mapped[str | None] = mapped_column(String(50), default=None)
    source: Mapped[ParticipantSource] = mapped_column(
        str_enum(ParticipantSource), default=ParticipantSource.day_of
    )

    race: Mapped[Race] = relationship(back_populates="participants")

    # Bib uniqueness is per *event* (across races), which a per-table constraint
    # can't express — enforced in services/participants.py.


class FinishRecord(Base):
    __tablename__ = "finish_records"
    # Append-only: undo sets status='voided'; rows are never deleted or overwritten.

    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    bib: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    # authoritative finish time, captured on the client (offline-first outbox)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime)
    client_id: Mapped[str] = mapped_column(String(36), unique=True)  # idempotency key
    status: Mapped[FinishStatus] = mapped_column(str_enum(FinishStatus), default=FinishStatus.ok)
    created_by: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    race: Mapped[Race] = relationship(back_populates="finishes")


# Total finish records per race (any status) — lets the admin UI disable the
# "clear results" button when there is nothing to clear. Derived, never stored.
Race.finish_count = column_property(
    select(func.count(FinishRecord.id))
    .where(FinishRecord.race_id == Race.id)
    .correlate_except(FinishRecord)
    .scalar_subquery(),
    deferred=False,
)

# Registered participants per race — lets the admin UI guard the "delete race"
# button (a race can only be deleted when it holds no participants/finishes).
Race.participant_count = column_property(
    select(func.count(Participant.id))
    .where(Participant.race_id == Race.id)
    .correlate_except(Participant)
    .scalar_subquery(),
    deferred=False,
)
