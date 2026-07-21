"""Finish records: idempotency by client_id, conflicts never overwrite,
void/assign via PATCH, role restrictions."""

from datetime import timedelta

from sqlalchemy import select

from app.models import FinishRecord, FinishStatus, Gender, RaceStatus, Role
from tests.conftest import T0, login, make_finish, make_participant

CLIENT_ID = "11111111-1111-1111-1111-111111111111"


def test_assigning_bib_reroutes_finish_to_the_bibs_race(db, client, event, race5, race10):
    login(client, db, Role.admin)
    # 10 km started a minute after the 5 km — so the race a finish belongs to
    # changes its derived elapsed time
    race10.started_at = T0 + timedelta(seconds=60)
    race10.status = RaceStatus.running
    make_participant(db, race10, 77, first="Zoe", gender=Gender.w)
    # a numberless finish captured under the running 5 km (the default race)
    rec = make_finish(db, race5, None, seconds=1200, status=FinishStatus.unassigned)
    db.commit()

    resp = client.patch(f"/api/finishes/{rec.id}", json={"bib": 77})
    assert resp.status_code == 200
    body = resp.json()
    assert body["race_id"] == race10.id  # moved to the bib's race
    assert body["race_name"] == "10 km"
    assert body["status"] == "ok"
    assert body["participant_name"] == "Zoe Test"
    assert body["elapsed_seconds"] == 1140  # 1200 − 60: timed against 10 km's start


def test_assigning_an_unknown_bib_keeps_the_current_race(db, client, event, race5):
    login(client, db, Role.admin)
    rec = make_finish(db, race5, None, seconds=900, status=FinishStatus.unassigned)
    db.commit()

    resp = client.patch(f"/api/finishes/{rec.id}", json={"bib": 999})
    assert resp.status_code == 200
    body = resp.json()
    assert body["race_id"] == race5.id  # no such participant → race unchanged
    assert body["bib"] == 999


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
    finish_id = resp.json()["id"]

    undone = client.patch(f"/api/finishes/{finish_id}", json={"status": "voided"})
    assert undone.status_code == 200
    assert undone.json()["status"] == "voided"
    assert len(db.scalars(select(FinishRecord)).all()) == 1  # still there

    # undo the deletion: the record is restored, its status recomputed from bib
    restored = client.patch(f"/api/finishes/{finish_id}", json={"status": "ok"})
    assert restored.status_code == 200
    assert restored.json()["status"] == "ok"
    assert len(db.scalars(select(FinishRecord)).all()) == 1  # never a new row


def test_restore_recomputes_conflict_and_unassigned(db, client, event, race5):
    login(client, db, Role.timer)
    make_participant(db, race5, 5)

    # a voided finish restored while the bib now has an ok finish → conflict
    voided = make_finish(db, race5, 5, 1000, status=FinishStatus.voided)
    make_finish(db, race5, 5, 1100)  # ok record for the same bib
    db.commit()
    restored = client.patch(f"/api/finishes/{voided.id}", json={"status": "ok"})
    assert restored.json()["status"] == "conflict"  # never overwrites the ok one

    # a voided finish without a bib comes back as unassigned
    no_bib = make_finish(db, race5, None, 1200, status=FinishStatus.voided)
    db.commit()
    restored2 = client.patch(f"/api/finishes/{no_bib.id}", json={"status": "ok"})
    assert restored2.json()["status"] == "unassigned"


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


def test_event_finish_list_spans_races(db, client, event, race5, race10):
    login(client, db, Role.timer)
    make_participant(db, race5, 1)
    make_participant(db, race10, 2, first="Jan", gender=Gender.m)
    race10.started_at = T0
    make_finish(db, race5, 1, 1000)
    make_finish(db, race10, 2, 2000)

    resp = client.get(f"/api/events/{event.id}/finishes")
    assert resp.status_code == 200
    rows = resp.json()
    assert [(r["bib"], r["race_name"]) for r in rows] == [(2, "10 km"), (1, "5 km")]


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


def test_timer_can_read_events_and_bib_map(db, client, event, race5, race10):
    login(client, db, Role.timer)
    make_participant(db, race5, 1, first="Katrin", last="Albrecht", gender=Gender.w)
    make_participant(db, race10, 2, first="Jan", last="Berg", gender=Gender.m)
    # a Paarlauf pair sharing bib 10 on the 5 km
    make_participant(db, race5, 10, first="Lena", last="Lorenz", gender=Gender.w, pair_group="p1")
    make_participant(db, race5, 10, first="Marco", last="Lorenz", gender=Gender.m, pair_group="p1")

    events = client.get("/api/timer/events")
    assert events.status_code == 200
    assert any(e["name"] == "Frontrun 2026" for e in events.json())

    bibs = client.get(f"/api/events/{event.id}/bibs")
    assert bibs.status_code == 200
    by_bib = {b["bib"]: b for b in bibs.json()}
    assert by_bib[2]["race_name"] == "10 km"
    assert by_bib[1]["race_name"] == "5 km"
    assert by_bib[10]["name"] == "Lena Lorenz & Marco Lorenz"  # pair merged


def test_bib_map_requires_auth(client, db, event, race5):
    assert client.get("/api/timer/events").status_code == 401
    assert client.get(f"/api/events/{event.id}/bibs").status_code == 401
