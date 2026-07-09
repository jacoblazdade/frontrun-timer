"""Finish records: idempotency by client_id, conflicts never overwrite,
void/assign via PATCH, role restrictions."""

from datetime import timedelta

from sqlalchemy import select

from app.models import FinishRecord, Gender, Role
from tests.conftest import T0, login, make_finish, make_participant

CLIENT_ID = "11111111-1111-1111-1111-111111111111"


def _post_finish(client, race, bib, client_id=CLIENT_ID, seconds=1200):
    return client.post(
        f"/api/races/{race.id}/finishes",
        json={
            "client_id": client_id,
            "bib": bib,
            "recorded_at": (T0 + timedelta(seconds=seconds)).isoformat(),
        },
    )


def test_finish_creation_is_idempotent_by_client_id(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 5, first="Eva", gender=Gender.w)

    first = _post_finish(client, race5, 5)
    assert first.status_code == 201
    assert first.json()["status"] == "ok"
    assert first.json()["participant_name"] == "Eva Test"
    assert first.json()["elapsed_seconds"] == 1200

    # outbox replays the same tap (even with a drifted timestamp): no new record
    replay = _post_finish(client, race5, 5, seconds=1201)
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["recorded_at"] == first.json()["recorded_at"]
    assert len(db.scalars(select(FinishRecord)).all()) == 1


def test_second_finish_for_same_bib_becomes_conflict(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 5)
    first = _post_finish(client, race5, 5)
    second = _post_finish(client, race5, 5, client_id="22222222-2222-2222-2222-222222222222",
                          seconds=1300)
    assert second.status_code == 201
    assert second.json()["status"] == "conflict"
    # the original record is untouched
    original = db.get(FinishRecord, first.json()["id"])
    assert original.status.value == "ok"


def test_missing_bib_is_logged_unassigned_then_assigned_later(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 9, first="Jan", gender=Gender.m)

    resp = _post_finish(client, race5, None)
    assert resp.json()["status"] == "unassigned"

    patched = client.patch(f"/api/finishes/{resp.json()['id']}", json={"bib": 9})
    assert patched.status_code == 200
    assert patched.json()["status"] == "ok"
    assert patched.json()["participant_name"] == "Jan Test"


def test_assigning_a_taken_bib_yields_conflict_not_overwrite(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 9)
    make_finish(db, race5, 9, 1000)

    resp = _post_finish(client, race5, None)
    patched = client.patch(f"/api/finishes/{resp.json()['id']}", json={"bib": 9})
    assert patched.json()["status"] == "conflict"


def test_undo_voids_and_never_deletes(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 5)
    resp = _post_finish(client, race5, 5)

    undone = client.patch(f"/api/finishes/{resp.json()['id']}", json={"status": "voided"})
    assert undone.status_code == 200
    assert undone.json()["status"] == "voided"
    assert len(db.scalars(select(FinishRecord)).all()) == 1  # still there

    # anything but 'voided' is rejected — records are append-only
    rejected = client.patch(f"/api/finishes/{resp.json()['id']}", json={"status": "ok"})
    assert rejected.status_code == 422


def test_recent_finishes_listing(db, client, event, race5):
    login(client, db, Role.timer)
    for i in range(12):
        make_participant(db, race5, i + 1)
        make_finish(db, race5, i + 1, 1000 + i)

    resp = client.get(f"/api/races/{race5.id}/finishes?limit=10")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 10
    assert rows[0]["bib"] == 12  # newest first


def test_timer_role_cannot_touch_admin_endpoints(db, client, event, race5):
    login(client, db, Role.timer)
    assert client.post(f"/api/races/{race5.id}/start").status_code == 403
    assert (
        client.post(
            "/api/participants",
            json={"race_id": race5.id, "bib": 1, "first_name": "A", "last_name": "B",
                  "gender": "m"},
        ).status_code
        == 403
    )
    assert client.get(f"/api/events/{event.id}/next-bib").status_code == 403


def test_finish_endpoints_require_auth(client, db, event, race5):
    assert _post_finish(client, race5, 5).status_code == 401
