"""Seed a demo event: two races, ~50 participants (incl. Paarlauf pairs),
an admin user and a timer user. Deterministic (seeded RNG) so reruns are
reproducible; skips if the demo event already exists.

Run with: uv run python -m app.cli seed
"""

import random
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import Event, Gender, Participant, ParticipantSource, Race, Role, User
from app.security import hash_password

DEMO_EVENT_NAME = "Frontrun 2026"

FIRST_M = ["Lukas", "Jonas", "Felix", "Paul", "Max", "David", "Jan", "Tim", "Erik", "Nils"]
FIRST_W = ["Anna", "Lena", "Marie", "Laura", "Sophie", "Julia", "Emma", "Mia", "Clara", "Nina"]
FIRST_X = ["Kim", "Robin", "Toni"]
LAST = [
    "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner",
    "Becker", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Neumann", "Braun",
]
CLUBS = ["LG Nord", "SV Frontrun", "TSV Eiche", "Lauftreff Süd", None, None]


def _ensure_user(db: Session, username: str, password: str, role: Role) -> bool:
    if db.scalar(select(User).where(User.username == username)):
        return False
    db.add(User(username=username, password_hash=hash_password(password), role=role))
    return True


def seed(db: Session | None = None) -> None:
    own_session = db is None
    if own_session:
        db = get_sessionmaker()()
    try:
        if _ensure_user(db, "admin", "admin", Role.admin):
            print("created user 'admin' with password 'admin' — CHANGE IT for production")
        if _ensure_user(db, "timer", "timer", Role.timer):
            print("created user 'timer' with password 'timer' — CHANGE IT for production")

        if db.scalar(select(Event).where(Event.name == DEMO_EVENT_NAME)):
            print(f"event {DEMO_EVENT_NAME!r} already exists, skipping event seed")
            db.commit()
            return

        rng = random.Random(42)
        event = Event(name=DEMO_EVENT_NAME, date=date(2026, 9, 12), is_published=True)
        race5 = Race(event=event, name="5 km")
        race10 = Race(event=event, name="10 km")
        db.add_all([event, race5, race10])
        db.flush()

        bib = 100
        for i in range(44):
            gender = rng.choices([Gender.m, Gender.w, Gender.x], weights=[10, 10, 1])[0]
            first = rng.choice(
                {Gender.m: FIRST_M, Gender.w: FIRST_W, Gender.x: FIRST_X}[gender]
            )
            bib += 1
            db.add(
                Participant(
                    race_id=(race5.id if i % 2 == 0 else race10.id),
                    bib=bib,
                    first_name=first,
                    last_name=rng.choice(LAST),
                    gender=gender,
                    birth_year=rng.randint(1955, 2012),
                    club=rng.choice(CLUBS),
                    source=ParticipantSource.imported,
                    # most of a registered field turns up; a few never do
                    registered=rng.random() < 0.85,
                )
            )

        # three Paarlauf groups on the 5 km (two pairs + one trio): members
        # share bib and pair_group and rank as a single place. A group always
        # runs AllGender — the gender below only picks a plausible first name.
        group_members = [
            [Gender.m, Gender.w],
            [Gender.w, Gender.w],
            [Gender.m, Gender.w, Gender.m],  # a trio — groups may exceed two
        ]
        for group_no, members in enumerate(group_members, start=1):
            bib += 1
            for gender in members:
                first = rng.choice({Gender.m: FIRST_M, Gender.w: FIRST_W}[gender])
                db.add(
                    Participant(
                        race_id=race5.id,
                        bib=bib,
                        first_name=first,
                        last_name=rng.choice(LAST),
                        gender=Gender.x,
                        birth_year=rng.randint(1970, 2005),
                        club=rng.choice(CLUBS),
                        pair_group=f"group-{group_no}",
                        source=ParticipantSource.imported,
                        registered=True,
                    )
                )

        db.commit()
        print(f"seeded {DEMO_EVENT_NAME!r}: 2 races, 51 participants (3 Paarlauf groups)")
    finally:
        if own_session:
            db.close()
