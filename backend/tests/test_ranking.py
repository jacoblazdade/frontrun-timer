"""Ranking: category derivation, ordering, Paarlauf as one place, voided and
unassigned records excluded, ties."""

from app.models import FinishStatus, Gender
from app.services.ranking import event_results, format_elapsed
from tests.conftest import make_finish, make_participant


def _rows(db, event, category):
    _, rows = event_results(db, event, category=category)
    return rows


def test_ranking_orders_by_elapsed_within_category(db, event, race5):
    make_participant(db, race5, 1, first="Max", gender=Gender.m)
    make_participant(db, race5, 2, first="Tom", gender=Gender.m)
    make_participant(db, race5, 3, first="Eva", gender=Gender.w)
    make_finish(db, race5, 1, 1300)
    make_finish(db, race5, 2, 1200)
    make_finish(db, race5, 3, 1250)

    men = _rows(db, event, "Männer 5 km")
    assert [(r.rank, r.bib) for r in men] == [(1, 2), (2, 1)]

    women = _rows(db, event, "Frauen 5 km")
    assert [(r.rank, r.bib) for r in women] == [(1, 3)]

    everyone = _rows(db, event, "AllGender 5 km")
    assert [(r.rank, r.bib) for r in everyone] == [(1, 2), (2, 3), (3, 1)]


def test_gender_x_only_in_allgender(db, event, race5):
    make_participant(db, race5, 7, first="Kim", gender=Gender.x)
    make_finish(db, race5, 7, 1000)

    categories, rows = event_results(db, event)
    assert categories == ["Männer 5 km", "Frauen 5 km", "AllGender 5 km"]
    assert [r.category for r in rows] == ["AllGender 5 km"]
    assert rows[0].bib == 7


def test_voided_and_unassigned_records_do_not_count(db, event, race5):
    make_participant(db, race5, 1, gender=Gender.w)
    make_finish(db, race5, 1, 900, status=FinishStatus.voided)
    make_finish(db, race5, None, 950, status=FinishStatus.unassigned)
    make_finish(db, race5, 1, 1200)

    rows = _rows(db, event, "Frauen 5 km")
    assert len(rows) == 1
    assert rows[0].elapsed_seconds == 1200


def test_paarlauf_pair_is_one_place_and_not_in_gender_categories(db, event, race5):
    make_participant(db, race5, 10, first="Max", last="A", gender=Gender.m, pair_group="p1")
    make_participant(db, race5, 10, first="Eva", last="B", gender=Gender.w, pair_group="p1")
    make_participant(db, race5, 11, first="Jan", last="C", gender=Gender.m, pair_group="p2")
    make_participant(db, race5, 11, first="Mia", last="D", gender=Gender.w, pair_group="p2")
    make_finish(db, race5, 10, 1500)
    make_finish(db, race5, 11, 1400)

    pairs = _rows(db, event, "Paarlauf 5 km")
    assert [(r.rank, r.bib) for r in pairs] == [(1, 11), (2, 10)]
    assert pairs[1].name == "Max A & Eva B"

    assert _rows(db, event, "Männer 5 km") == []
    assert _rows(db, event, "Frauen 5 km") == []
    assert _rows(db, event, "AllGender 5 km") == []


def test_ties_share_a_rank(db, event, race5):
    for bib in (1, 2, 3):
        make_participant(db, race5, bib, gender=Gender.m)
    make_finish(db, race5, 1, 1000)
    make_finish(db, race5, 2, 1000)
    make_finish(db, race5, 3, 1001)

    rows = _rows(db, event, "Männer 5 km")
    assert [r.rank for r in rows] == [1, 1, 3]


def test_races_without_start_have_categories_but_no_rows(db, event, race10):
    make_participant(db, race10, 1, gender=Gender.m)
    categories, rows = event_results(db, event)
    assert categories == ["Männer 10 km", "Frauen 10 km", "AllGender 10 km"]
    assert rows == []


def test_all_race_tabs_exist_before_the_first_finisher(db, event, race5, race10):
    """Regression: the 10 km categories must be listed even while only the
    5 km has finishers — the public page builds its tabs from this list."""
    make_participant(db, race5, 1, gender=Gender.w)
    make_participant(db, race10, 2, gender=Gender.m)
    # registered Paarlauf pair, not finished yet → tab still appears
    make_participant(db, race5, 10, gender=Gender.m, pair_group="p1")
    make_participant(db, race5, 10, first="Eva", gender=Gender.w, pair_group="p1")
    make_finish(db, race5, 1, 1200)  # only a 5 km finish exists

    categories, rows = event_results(db, event)
    assert categories == [
        "Männer 5 km",
        "Frauen 5 km",
        "AllGender 5 km",
        "Paarlauf 5 km",
        "Männer 10 km",
        "Frauen 10 km",
        "AllGender 10 km",
    ]
    assert [r.bib for r in rows if r.category == "Frauen 5 km"] == [1]


def test_format_elapsed():
    assert format_elapsed(59) == "0:00:59"
    assert format_elapsed(1305) == "0:21:45"
    assert format_elapsed(3600 + 62) == "1:01:02"
