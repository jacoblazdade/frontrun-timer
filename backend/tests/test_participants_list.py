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


def test_participants_xlsx_export_round_trips_into_the_importer(db, client, event, race5, race10):
    """The export is the whole event, ordered by bib — and its headers are the
    ones the importer maps, so an exported file can be imported back."""
    import io

    from openpyxl import load_workbook

    login(client, db, Role.admin)
    make_participant(db, race5, 3, first="Cara", last="Meier", birth_year=1988, club="TV Köln")
    make_participant(db, race10, 1, first="Ben", last="Schmidt", gender=Gender.m)
    make_participant(db, race5, 2, first="Lena", last="Lorenz", pair_group="p2")
    make_participant(db, race5, 2, first="Marco", last="Lorenz", gender=Gender.m, pair_group="p2")
    db.commit()

    resp = client.get(f"/api/events/{event.id}/participants.xlsx")
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]

    ws = load_workbook(io.BytesIO(resp.content)).active
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0] == (
        "Startnummer", "Vorname", "Nachname", "Geschlecht", "Jahrgang",
        "Verein", "Paarlauf-Gruppe", "Rennen", "Quelle", "Anwesend",
    )
    # every runner of every race, bib order, pair members adjacent
    assert [(r[0], r[1]) for r in rows[1:]] == [
        (1, "Ben"), (2, "Lena"), (2, "Marco"), (3, "Cara")
    ]
    assert rows[1][7] == "10 km"  # race column follows the participant's race
    assert rows[4][5] == "TV Köln"

    # the importer recognises the exported headers without remapping
    from app.services.importer import IMPORT_FIELDS

    header_guess = {
        "bib": "Startnummer", "first_name": "Vorname", "last_name": "Nachname",
        "gender": "Geschlecht", "birth_year": "Jahrgang", "club": "Verein",
        "pair_group": "Paarlauf-Gruppe", "race": "Rennen",
    }
    assert set(header_guess) <= IMPORT_FIELDS
    assert set(header_guess.values()) <= set(rows[0])


def test_exports_are_admin_only(db, client, event, race5):
    """The results export is linked from the public results page for admins —
    it must stay guarded for everyone else."""
    assert client.get(f"/api/events/{event.id}/export.xlsx").status_code == 401
    assert client.get(f"/api/events/{event.id}/participants.xlsx").status_code == 401
    login(client, db, Role.timer)
    assert client.get(f"/api/events/{event.id}/export.xlsx").status_code == 403
    assert client.get(f"/api/events/{event.id}/participants.xlsx").status_code == 403
