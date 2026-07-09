import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.deps import get_db
from app.main import app
from app.models import (
    Event,
    FinishRecord,
    FinishStatus,
    Gender,
    Participant,
    Race,
    RaceStatus,
    Role,
    User,
)
from app.security import hash_password

# fixed race start used across tests
T0 = datetime(2026, 9, 12, 10, 0, 0, tzinfo=UTC)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def client(db):
    def override():
        yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def event(db):
    ev = Event(name="Frontrun 2026", date=date(2026, 9, 12), is_published=True)
    db.add(ev)
    db.flush()
    return ev


@pytest.fixture
def race5(db, event):
    race = Race(event_id=event.id, name="5 km", status=RaceStatus.running, started_at=T0)
    db.add(race)
    db.flush()
    return race


@pytest.fixture
def race10(db, event):
    race = Race(event_id=event.id, name="10 km", status=RaceStatus.pending)
    db.add(race)
    db.flush()
    return race


def make_participant(
    db: Session,
    race: Race,
    bib: int,
    first="Anna",
    last="Test",
    gender=Gender.w,
    **kwargs,
) -> Participant:
    p = Participant(
        race_id=race.id, bib=bib, first_name=first, last_name=last, gender=gender, **kwargs
    )
    db.add(p)
    db.flush()
    return p


def make_finish(
    db: Session,
    race: Race,
    bib: int | None,
    seconds: float,
    status: FinishStatus = FinishStatus.ok,
    **kwargs,
) -> FinishRecord:
    f = FinishRecord(
        race_id=race.id,
        bib=bib,
        recorded_at=(race.started_at or T0) + timedelta(seconds=seconds),
        client_id=str(uuid.uuid4()),
        status=status,
        created_by="test",
        **kwargs,
    )
    db.add(f)
    db.flush()
    return f


def login(client: TestClient, db: Session, role: Role = Role.admin) -> TestClient:
    """Creates (or reuses) a user for `role` and logs the client in."""
    username = f"test-{role.value}"
    if not db.query(User).filter_by(username=username).first():
        db.add(User(username=username, password_hash=hash_password("pw"), role=role))
        db.flush()
    resp = client.post("/api/auth/login", json={"username": username, "password": "pw"})
    assert resp.status_code == 200, resp.text
    return client
