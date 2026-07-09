"""Elapsed time is derived, never stored: correcting a race's start time
retroactively fixes all results, and `since` polling picks the change up."""

from datetime import timedelta

from app.models import Gender, Role
from tests.conftest import T0, login, make_finish, make_participant


def _results(client, event, **params):
    resp = client.get(f"/api/events/{event.id}/results", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_start_time_correction_recalculates_all_elapsed(db, client, event, race5):
    make_participant(db, race5, 1, first="Max", gender=Gender.m)
    make_participant(db, race5, 2, first="Tom", gender=Gender.m)
    make_finish(db, race5, 1, 1200)
    make_finish(db, race5, 2, 1300)
    db.commit()

    before = _results(client, event, category="Männer 5 km")
    assert [r["elapsed_seconds"] for r in before["results"]] == [1200, 1300]

    # the gun actually went off 60s earlier than the button press
    login(client, db, Role.admin)
    resp = client.patch(
        f"/api/races/{race5.id}",
        json={"started_at": (T0 - timedelta(seconds=60)).isoformat()},
    )
    assert resp.status_code == 200

    after = _results(client, event, category="Männer 5 km")
    assert [r["elapsed_seconds"] for r in after["results"]] == [1260, 1360]
    assert after["results"][0]["time"] == "0:21:00"


def test_since_polling_returns_changes_after_start_correction(db, client, event, race5):
    make_participant(db, race5, 1, gender=Gender.m)
    make_finish(db, race5, 1, 1200)
    db.commit()

    first_poll = _results(client, event)
    cursor = first_poll["server_time"]
    assert len(first_poll["results"]) > 0

    # nothing changed since the cursor
    assert _results(client, event, since=cursor)["results"] == []

    # a start-time correction changes every elapsed time → rows reappear
    login(client, db, Role.admin)
    client.patch(
        f"/api/races/{race5.id}",
        json={"started_at": (T0 - timedelta(seconds=30)).isoformat()},
    )
    changed = _results(client, event, since=cursor)["results"]
    assert len(changed) > 0
    assert changed[0]["elapsed_seconds"] == 1230


def test_since_polling_returns_new_finishes_only(db, client, event, race5):
    make_participant(db, race5, 1, gender=Gender.m)
    make_participant(db, race5, 2, gender=Gender.m)
    make_finish(db, race5, 1, 1200)
    db.commit()

    cursor = _results(client, event)["server_time"]

    make_finish(db, race5, 2, 1100)
    db.commit()
    changed = _results(client, event, category="Männer 5 km", since=cursor)["results"]
    assert [r["bib"] for r in changed] == [2]
    assert changed[0]["rank"] == 1  # rank is computed over the full field


def test_unpublished_event_results_are_hidden(db, client, event, race5):
    event.is_published = False
    db.commit()
    assert client.get(f"/api/events/{event.id}/results").status_code == 404
    assert client.get("/api/events").json() == []


def test_public_bib_lookup(db, client, event, race5):
    make_participant(db, race5, 12, first="Eva", last="Kurz", gender=Gender.w, club="LG Nord")
    resp = client.get(f"/api/races/{race5.id}/lookup", params={"bib": 12})
    assert resp.status_code == 200
    assert resp.json() == {"bib": 12, "name": "Eva Kurz", "club": "LG Nord"}
    assert client.get(f"/api/races/{race5.id}/lookup", params={"bib": 999}).status_code == 404
