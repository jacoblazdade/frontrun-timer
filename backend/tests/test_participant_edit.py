"""Editing a participant: every field is patchable, and the rules that can't
live in the schema answer with a message the admin table can show."""

from datetime import date

from app.models import Event, Gender, Participant, ParticipantSource, Race, Role
from tests.conftest import login, make_participant


def _admin(client, db):
    return login(client, db, Role.admin)


def test_every_field_can_be_edited(db, client, event, race5, race10):
    _admin(client, db)
    p = make_participant(db, race5, 1)
    db.commit()

    resp = client.patch(
        f"/api/participants/{p.id}",
        json={
            "race_id": race10.id,
            "bib": 77,
            "first_name": "Bea",
            "last_name": "Neu",
            "gender": "x",
            "birth_year": 1999,
            "club": "LG Süd",
            "pair_group": None,
            "source": "import",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["race_id"] == race10.id
    assert (body["bib"], body["first_name"], body["last_name"]) == (77, "Bea", "Neu")
    assert (body["gender"], body["birth_year"], body["club"]) == ("x", 1999, "LG Süd")
    assert body["source"] == "import"


def test_blank_optional_fields_are_stored_as_null(db, client, event, race5):
    _admin(client, db)
    p = make_participant(db, race5, 1, club="LG Nord", pair_group="p1")
    db.commit()

    resp = client.patch(f"/api/participants/{p.id}", json={"club": "  ", "pair_group": ""})
    assert resp.status_code == 200, resp.text
    assert resp.json()["club"] is None
    assert resp.json()["pair_group"] is None


def test_names_are_trimmed_and_may_not_be_blank(db, client, event, race5):
    _admin(client, db)
    p = make_participant(db, race5, 1)
    db.commit()

    assert client.patch(f"/api/participants/{p.id}", json={"first_name": "  Ida  "}).json()[
        "first_name"
    ] == "Ida"
    assert client.patch(f"/api/participants/{p.id}", json={"first_name": "   "}).status_code == 422
    assert client.patch(f"/api/participants/{p.id}", json={"first_name": ""}).status_code == 422


def test_invalid_values_are_rejected_with_422(db, client, event, race5):
    _admin(client, db)
    p = make_participant(db, race5, 1)
    db.commit()

    assert client.patch(f"/api/participants/{p.id}", json={"bib": 0}).status_code == 422
    assert client.patch(f"/api/participants/{p.id}", json={"birth_year": 1800}).status_code == 422
    assert client.patch(f"/api/participants/{p.id}", json={"gender": "q"}).status_code == 422
    assert client.patch(f"/api/participants/{p.id}", json={"source": "guess"}).status_code == 422


def test_taken_bib_conflict_names_the_runner_in_the_way(db, client, event, race5, race10):
    _admin(client, db)
    make_participant(db, race5, 7, first="Otto", last="Blocker", gender=Gender.m)
    p = make_participant(db, race10, 8)
    db.commit()

    resp = client.patch(f"/api/participants/{p.id}", json={"bib": 7})
    assert resp.status_code == 409
    assert "Otto Blocker" in resp.json()["detail"]


def test_moving_to_another_event_is_refused(db, client, event, race5):
    _admin(client, db)
    other = Event(name="Other", date=date(2027, 9, 12))
    db.add(other)
    db.flush()
    other_race = Race(event_id=other.id, name="5 km")
    db.add(other_race)
    db.flush()
    p = make_participant(db, race5, 1)
    db.commit()

    resp = client.patch(f"/api/participants/{p.id}", json={"race_id": other_race.id})
    assert resp.status_code == 409
    assert "another event" in resp.json()["detail"]


def test_group_member_cannot_wander_into_another_race(db, client, event, race5, race10):
    _admin(client, db)
    a = make_participant(db, race5, 42, first="Ann", pair_group="p1")
    make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    resp = client.patch(f"/api/participants/{a.id}", json={"race_id": race10.id})
    assert resp.status_code == 409
    assert "Paarlauf" in resp.json()["detail"] and "Ben" in resp.json()["detail"]


def test_leaving_a_group_without_a_new_bib_is_refused(db, client, event, race5):
    _admin(client, db)
    a = make_participant(db, race5, 42, first="Ann", pair_group="p1")
    make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    resp = client.patch(f"/api/participants/{a.id}", json={"pair_group": None})
    assert resp.status_code == 409
    assert "free bib" in resp.json()["detail"]


def test_leaving_a_group_with_a_free_bib_unpairs_the_survivor(db, client, event, race5):
    _admin(client, db)
    a = make_participant(db, race5, 42, first="Ann", pair_group="p1")
    b = make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    resp = client.patch(f"/api/participants/{a.id}", json={"bib": 43, "pair_group": None})
    assert resp.status_code == 200, resp.text

    db.refresh(b)
    # the one left behind is a solo runner again, not a group missing a member
    assert b.pair_group is None and b.bib == 42
    assert db.get(Participant, a.id).bib == 43


def test_a_group_of_three_survives_one_member_leaving(db, client, event, race5):
    _admin(client, db)
    a = make_participant(db, race5, 42, first="Ann", pair_group="p1")
    b = make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    c = make_participant(db, race5, 42, first="Cem", gender=Gender.m, pair_group="p1")
    db.commit()

    assert client.patch(
        f"/api/participants/{a.id}", json={"bib": 43, "pair_group": None}
    ).status_code == 200

    db.refresh(b)
    db.refresh(c)
    assert b.pair_group == "p1" and c.pair_group == "p1"  # still a group of two


def test_editing_within_a_group_keeps_the_shared_bib(db, client, event, race5):
    _admin(client, db)
    a = make_participant(db, race5, 42, pair_group="p1")
    make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    resp = client.patch(f"/api/participants/{a.id}", json={"club": "LG Nord", "birth_year": 1988})
    assert resp.status_code == 200, resp.text
    assert resp.json()["bib"] == 42


def test_moving_a_whole_group_to_another_race_one_by_one(db, client, event, race5, race10):
    """Both members have to move, and the first move needs the group to give up
    the shared bib — so the supported path is: split, move, re-group."""
    _admin(client, db)
    a = make_participant(db, race5, 42, first="Ann", pair_group="p1")
    b = make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    # Ann takes a free bib and leaves the group, which dissolves it
    assert client.patch(
        f"/api/participants/{a.id}", json={"bib": 43, "pair_group": None}
    ).status_code == 200
    # both move to the 10 km
    assert client.patch(f"/api/participants/{a.id}", json={"race_id": race10.id}).status_code == 200
    assert client.patch(f"/api/participants/{b.id}", json={"race_id": race10.id}).status_code == 200
    # and pair up again on Ben's bib
    assert client.patch(
        f"/api/participants/{b.id}", json={"pair_group": "p1"}
    ).status_code == 200
    assert client.patch(
        f"/api/participants/{a.id}", json={"bib": 42, "pair_group": "p1"}
    ).status_code == 200

    db.refresh(a)
    db.refresh(b)
    assert a.race_id == b.race_id == race10.id and a.bib == b.bib == 42


def test_source_round_trips_through_the_list(db, client, event, race5):
    _admin(client, db)
    p = make_participant(db, race5, 1, source=ParticipantSource.day_of)
    db.commit()

    client.patch(f"/api/participants/{p.id}", json={"source": "import"})
    listed = client.get(f"/api/events/{event.id}/participants").json()["items"]
    assert listed[0]["source"] == "import"
