"""Event creation, simultaneous race start (shared gun time), bulk clearing
of a race's finish records."""

from sqlalchemy import select

from app.models import FinishRecord, Role
from tests.conftest import login, make_finish, make_participant


def test_create_event_with_races(db, client):
    login(client, db, Role.admin)
    resp = client.post(
        "/api/events",
        json={"name": "Frontrun 2027", "date": "2027-09-11", "races": ["5 km", "10 km"]},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_published"] is False  # publish is a deliberate step later
    assert [r["name"] for r in body["races"]] == ["5 km", "10 km"]
    assert all(r["started_at"] is None for r in body["races"])


def test_start_all_races_shares_one_gun_time(db, client):
    login(client, db, Role.admin)
    event_id = client.post(
        "/api/events", json={"name": "Frontrun 2027", "date": "2027-09-11"}
    ).json()["id"]

    resp = client.post(f"/api/events/{event_id}/start-races")
    assert resp.status_code == 200
    races = resp.json()["races"]
    assert all(r["status"] == "running" for r in races)
    # both races start on the same gun: identical timestamp
    assert len({r["started_at"] for r in races}) == 1

    # second start attempt is rejected — correct via PATCH instead
    assert client.post(f"/api/events/{event_id}/start-races").status_code == 409


def test_start_all_races_skips_already_started(db, client, event, race5, race10):
    # race5 fixture is already running with started_at=T0
    login(client, db, Role.admin)
    resp = client.post(f"/api/events/{event.id}/start-races")
    by_name = {r["name"]: r for r in resp.json()["races"]}
    assert by_name["5 km"]["started_at"].startswith("2026-09-12T10:00:00")  # untouched
    assert by_name["10 km"]["started_at"] is not None


def test_clear_finishes_deletes_all_records_for_the_race(db, client, event, race5, race10):
    login(client, db, Role.admin)
    make_participant(db, race5, 1)
    make_finish(db, race5, 1, 1000)
    make_finish(db, race5, None, 1100)
    other = make_finish(db, race10, 2, 2000)
    db.commit()

    resp = client.delete(f"/api/races/{race5.id}/finishes")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 2}
    remaining = db.scalars(select(FinishRecord)).all()
    assert [f.id for f in remaining] == [other.id]  # other race untouched


def test_clear_participants_empties_the_whole_event(db, client, event, race5, race10):
    login(client, db, Role.admin)
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    make_participant(db, race10, 3)
    db.commit()

    resp = client.delete(f"/api/events/{event.id}/participants")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 3}
    assert client.get(f"/api/events/{event.id}/participants").json() == []
    # next-bib starts over
    assert client.get(f"/api/events/{event.id}/next-bib").json() == {"next_bib": 1}


def test_clear_finishes_is_admin_only(db, client, event, race5):
    login(client, db, Role.timer)
    assert client.delete(f"/api/races/{race5.id}/finishes").status_code == 403
    assert client.delete(f"/api/events/{event.id}/participants").status_code == 403
    assert client.post("/api/events", json={"name": "X", "date": "2027-01-01"}).status_code == 403
    assert client.post(f"/api/events/{event.id}/start-races").status_code == 403
