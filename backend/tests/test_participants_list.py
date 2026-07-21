"""Paginated + searchable admin participant list, with pair-safe paging."""

from app.models import Gender, Role
from tests.conftest import login, make_participant


def test_pagination_returns_pages_of_size(db, client, event, race5):
    login(client, db, Role.admin)
    for bib in range(1, 126):  # 125 solo runners
        make_participant(db, race5, bib, last=f"R{bib}")
    db.commit()

    first = client.get(f"/api/events/{event.id}/participants?size=50&page=0").json()
    assert first["total"] == 125
    assert first["page_count"] == 3
    assert first["page"] == 0
    assert len(first["items"]) == 50
    assert first["items"][0]["bib"] == 1  # ordered by bib

    last = client.get(f"/api/events/{event.id}/participants?size=50&page=2").json()
    assert len(last["items"]) == 25
    assert last["items"][-1]["bib"] == 125

    # a page past the end clamps to the last page instead of erroring
    clamped = client.get(f"/api/events/{event.id}/participants?size=50&page=99").json()
    assert clamped["page"] == 2


def test_search_filters_across_all_pages(db, client, event, race5):
    login(client, db, Role.admin)
    make_participant(db, race5, 1, first="Anna", last="Meier")
    make_participant(db, race5, 2, first="Ben", last="Schmidt", club="TV Köln")
    make_participant(db, race5, 3, first="Cara", last="Meier")
    db.commit()

    by_name = client.get(f"/api/events/{event.id}/participants?q=meier").json()
    assert by_name["total"] == 2
    assert {p["first_name"] for p in by_name["items"]} == {"Anna", "Cara"}

    by_club = client.get(f"/api/events/{event.id}/participants?q=köln").json()
    assert by_club["total"] == 1
    assert by_club["items"][0]["first_name"] == "Ben"


def test_paarlauf_pair_never_split_across_a_page(db, client, event, race5):
    login(client, db, Role.admin)
    # fill page one so a pair would straddle the 2/3-per-page boundary
    make_participant(db, race5, 1, last="Solo1")
    make_participant(db, race5, 2, last="PairA", pair_group="p2")
    make_participant(db, race5, 2, first="Ben", gender=Gender.m, last="PairB", pair_group="p2")
    db.commit()

    # size=2 entries per page: entry 1 = bib 1, entry 2 = the bib-2 pair (both rows)
    page0 = client.get(f"/api/events/{event.id}/participants?size=2&page=0").json()
    bibs = [p["bib"] for p in page0["items"]]
    assert bibs == [1, 2, 2]  # the whole pair rides along on page 0
    assert page0["total"] == 3  # three people
    assert page0["page_count"] == 1  # but only two entries → one page
