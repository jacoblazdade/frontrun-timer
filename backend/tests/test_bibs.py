"""Bib uniqueness per event (across races), Paarlauf sharing, next free bib."""

import pytest

from app.models import Gender, Role
from app.services.participants import BibConflictError, assert_bib_available, next_free_bib
from tests.conftest import login, make_participant


def test_bib_unique_across_races_of_same_event(db, event, race5, race10):
    make_participant(db, race5, 42)
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race10.id)


def test_pair_partner_may_share_bib(db, event, race5, race10):
    make_participant(db, race5, 42, pair_group="p1")
    # same race + same pair_group: allowed
    assert_bib_available(db, event.id, 42, race_id=race5.id, pair_group="p1")
    # different race or different/missing pair_group: rejected
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race10.id, pair_group="p1")
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race5.id, pair_group="p2")
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race5.id)


def test_group_may_grow_beyond_two_members(db, event, race5):
    make_participant(db, race5, 42, pair_group="p1")
    make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    # a Paarlauf group is not capped at two — a third may join the same group
    assert_bib_available(db, event.id, 42, race_id=race5.id, pair_group="p1")
    # but only into the SAME group in the SAME race
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race5.id, pair_group="other")


def test_deleting_pair_member_unpairs_survivor(db, client, event, race5):
    login(client, db, Role.admin)
    a = make_participant(db, race5, 42, pair_group="p1")
    b = make_participant(db, race5, 42, first="Ben", gender=Gender.m, pair_group="p1")
    db.commit()

    resp = client.delete(f"/api/participants/{a.id}")
    assert resp.status_code == 204

    # the survivor is now a solo runner, not a pair with a missing partner
    db.refresh(b)
    assert b.pair_group is None
    # a solo runner holds the bib outright — it can no longer be re-paired
    with pytest.raises(BibConflictError):
        assert_bib_available(db, event.id, 42, race_id=race5.id, pair_group="p1")


def test_update_keeping_own_bib_is_allowed(db, event, race5):
    p = make_participant(db, race5, 42)
    assert_bib_available(db, event.id, 42, race_id=race5.id, exclude_id=p.id)


def test_next_free_bib(db, event, race5, race10):
    assert next_free_bib(db, event.id) == 1
    make_participant(db, race5, 5)
    make_participant(db, race10, 12)
    assert next_free_bib(db, event.id) == 13


def test_api_rejects_duplicate_bib_with_409(db, client, event, race5, race10):
    login(client, db, Role.admin)
    make_participant(db, race5, 7)
    resp = client.post(
        "/api/participants",
        json={
            "race_id": race10.id,
            "bib": 7,
            "first_name": "Neu",
            "last_name": "Läufer",
            "gender": "m",
        },
    )
    assert resp.status_code == 409


def test_next_bib_endpoint(db, client, event, race5):
    login(client, db, Role.admin)
    make_participant(db, race5, 100)
    resp = client.get(f"/api/events/{event.id}/next-bib")
    assert resp.status_code == 200
    assert resp.json() == {"next_bib": 101}
