"""Results import (the fallback-to-Excel path): time parsing, the bib deciding
the race, replace vs merge, and the append-only guarantee."""

import io
import json

import pytest
from openpyxl import Workbook
from sqlalchemy import select

from app.models import FinishRecord, FinishStatus, RaceStatus, Role
from app.services.importer import parse_table
from app.services.ranking import event_results
from app.services.results_import import MERGE, REPLACE, import_results, parse_elapsed
from tests.conftest import T0, login, make_finish, make_participant

MAPPING = {"bib": "Startnr.", "time": "Zeit"}

CSV = "Platz;Startnr.;Name;Zeit\n1;1;Anna Müller;0:20:00\n2;2;Max Schmidt;0:25:30\n"


def _rows(csv: str = CSV):
    return parse_table("results.csv", csv.encode())


# ---- time parsing ----


@pytest.mark.parametrize(
    ("raw", "seconds"),
    [
        ("0:20:00", 1200),
        ("1:02:03", 3723),
        ("00:42:15", 2535),  # datetime.time from an XLSX time cell
        ("42:15", 2535),  # MM:SS
        ("95:12", 5712),  # MM:SS may exceed an hour
        ("0:20:00.5", 1200.5),
        ("20:00,5", 1200.5),  # German decimal comma
        ("1899-12-30 00:42:15", 2535),  # Excel's epoch date on a time cell
        ("1200", 1200),  # bare seconds
        ("0.5", 43200),  # bare number below 1 = Excel day fraction
    ],
)
def test_parse_elapsed_accepts_the_shapes_excel_produces(raw, seconds):
    assert parse_elapsed(raw) == pytest.approx(seconds)


@pytest.mark.parametrize("raw", ["", "abc", "0:00:00", "-1", "1:75:00", "12:99"])
def test_parse_elapsed_rejects_junk(raw):
    with pytest.raises(ValueError):
        parse_elapsed(raw)


# ---- import ----


def test_import_derives_recorded_at_from_the_race_start(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    result = import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)

    assert result.committed and result.created == 2
    records = db.scalars(select(FinishRecord).order_by(FinishRecord.bib)).all()
    # elapsed is never stored — recorded_at carries it, relative to the start
    assert [(r.recorded_at - T0).total_seconds() for r in records] == [1200, 1530]
    assert all(r.status == FinishStatus.ok for r in records)


def test_dry_run_commits_nothing(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    result = import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=True)

    assert result.valid_rows == 2
    assert not result.committed
    assert db.scalars(select(FinishRecord)).all() == []


def test_bib_decides_the_race(db, event, race5, race10):
    make_participant(db, race5, 1)
    make_participant(db, race10, 2)
    result = import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)

    assert result.committed
    by_bib = {r.bib: r.race_id for r in db.scalars(select(FinishRecord))}
    assert by_bib == {1: race5.id, 2: race10.id}
    assert sorted(result.races) == ["10 km", "5 km"]


def test_unregistered_bib_is_an_error_and_blocks_the_whole_import(db, event, race5):
    make_participant(db, race5, 1)  # bib 2 was never registered
    result = import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)

    assert not result.committed
    assert len(result.errors) == 1
    assert result.errors[0].row == 3 and "not registered" in result.errors[0].message
    assert db.scalars(select(FinishRecord)).all() == []


def test_duplicate_bib_in_file_is_reported(db, event, race5):
    make_participant(db, race5, 1)
    csv = "Startnr.;Zeit\n1;0:20:00\n1;0:21:00\n"
    result = import_results(db, event, rows=_rows(csv), mapping=MAPPING, dry_run=True)

    assert any("appears twice" in e.message for e in result.errors)


def test_invalid_time_is_reported_per_row(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    csv = "Startnr.;Zeit\n1;0:20:00\n2;kaputt\n"
    result = import_results(db, event, rows=_rows(csv), mapping=MAPPING, dry_run=True)

    assert len(result.errors) == 1
    assert result.errors[0].row == 3 and "invalid time" in result.errors[0].message


def test_missing_mapping_is_reported(db, event, race5):
    result = import_results(db, event, rows=_rows(), mapping={"bib": "Startnr."}, dry_run=True)
    assert any("'time'" in e.message for e in result.errors)


def test_replace_voids_existing_finishes_instead_of_deleting_them(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    old = make_finish(db, race5, 1, seconds=999)
    stray = make_finish(db, race5, None, seconds=1, status=FinishStatus.unassigned)

    result = import_results(db, event, rows=_rows(), mapping=MAPPING, mode=REPLACE, dry_run=False)

    assert result.committed and result.voided == 2 and result.created == 2
    # append-only holds: the old records still exist, just voided
    assert old.status == FinishStatus.voided
    assert stray.status == FinishStatus.voided
    assert db.scalar(select(FinishRecord).where(FinishRecord.id == old.id)) is not None
    ok = db.scalars(select(FinishRecord).where(FinishRecord.status == FinishStatus.ok)).all()
    assert {(r.bib, (r.recorded_at - T0).total_seconds()) for r in ok} == {(1, 1200), (2, 1530)}


def test_replace_leaves_untouched_races_alone(db, event, race5, race10):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    other = make_participant(db, race10, 7)
    keep = make_finish(db, race10, other.bib, seconds=500)

    import_results(db, event, rows=_rows(), mapping=MAPPING, mode=REPLACE, dry_run=False)

    assert keep.status == FinishStatus.ok


def test_merge_refuses_to_overwrite_a_stored_finish(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    make_finish(db, race5, 1, seconds=999)

    result = import_results(db, event, rows=_rows(), mapping=MAPPING, mode=MERGE, dry_run=False)

    assert not result.committed
    assert any("already has a finish time" in e.message for e in result.errors)


def test_merge_adds_the_missing_times(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    make_finish(db, race5, 1, seconds=999)
    csv = "Startnr.;Zeit\n2;0:25:30\n"

    result = import_results(db, event, rows=_rows(csv), mapping=MAPPING, mode=MERGE, dry_run=False)

    assert result.committed and result.created == 1 and result.voided == 0
    ok = db.scalars(select(FinishRecord).where(FinishRecord.status == FinishStatus.ok)).all()
    assert {r.bib for r in ok} == {1, 2}


def test_race_without_a_start_time_gets_one_so_results_exist(db, event, race10):
    make_participant(db, race10, 1)
    make_participant(db, race10, 2)
    assert race10.started_at is None

    result = import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)

    assert result.started_races == ["10 km"]
    assert race10.started_at is not None and race10.status == RaceStatus.finished
    _, rows = event_results(db, event)
    # only differences matter: the imported net times come out unchanged
    assert [(r.bib, r.elapsed_seconds) for r in rows if r.category.startswith("Frauen")] == [
        (1, 1200.0),
        (2, 1530.0),
    ]


def test_a_started_race_keeps_its_start_time(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)
    assert race5.started_at == T0
    assert race5.status == RaceStatus.running  # untouched


def test_import_bumps_race_updated_at_so_pollers_refetch(db, event, race5):
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    before = race5.updated_at
    import_results(db, event, rows=_rows(), mapping=MAPPING, dry_run=False)
    assert race5.updated_at > before


def test_email_columns_are_dropped_here_too(db, event, race5):
    make_participant(db, race5, 1)
    csv = "Startnr.;Zeit;E-Mail\n1;0:20:00;a@example.com\n"
    result = import_results(db, event, rows=_rows(csv), mapping=MAPPING, dry_run=True)
    assert result.dropped_columns == ["E-Mail"]
    assert "E-Mail" not in result.columns


def test_results_export_roundtrips_through_the_importer(db, event, race5):
    """The workbook the app exports is exactly what it accepts back."""
    from app.services.exporter import results_workbook

    make_participant(db, race5, 1)
    make_participant(db, race5, 2)
    make_finish(db, race5, 1, seconds=1200)
    make_finish(db, race5, 2, seconds=1530)
    _, rows = event_results(db, event)
    xlsx = results_workbook(rows)

    parsed = parse_table("results.xlsx", xlsx)
    result = import_results(
        db, event, rows=parsed, mapping=MAPPING, mode=REPLACE, dry_run=False
    )
    assert result.committed and result.created == 2
    ok = db.scalars(select(FinishRecord).where(FinishRecord.status == FinishStatus.ok)).all()
    assert {(r.bib, (r.recorded_at - T0).total_seconds()) for r in ok} == {(1, 1200), (2, 1530)}


def test_xlsx_time_cells_are_understood(db, event, race5):
    from datetime import time

    make_participant(db, race5, 1)
    wb = Workbook()
    ws = wb.active
    ws.append(["Startnr.", "Zeit"])
    ws.append([1, time(0, 20, 0)])
    buf = io.BytesIO()
    wb.save(buf)

    result = import_results(
        db, event, rows=parse_table("r.xlsx", buf.getvalue()), mapping=MAPPING, dry_run=False
    )
    assert result.committed
    record = db.scalar(select(FinishRecord))
    assert (record.recorded_at - T0).total_seconds() == 1200


def test_import_results_endpoint_multipart(db, client, event, race5):
    login(client, db, Role.admin)
    make_participant(db, race5, 1)
    make_participant(db, race5, 2)

    resp = client.post(
        f"/api/events/{event.id}/import-results",
        files={"file": ("results.csv", CSV.encode(), "text/csv")},
        data={"mapping": json.dumps(MAPPING), "mode": REPLACE, "dry_run": "false"},
    )
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["committed"] is True
    assert report["created"] == 2
    assert report["races"] == ["5 km"]
    # the admin who uploaded is recorded as the author of the finish records
    assert {r.created_by for r in db.scalars(select(FinishRecord))} == {"test-admin"}


def test_import_results_endpoint_requires_admin(db, client, event, race5):
    login(client, db, Role.timer)
    resp = client.post(
        f"/api/events/{event.id}/import-results",
        files={"file": ("results.csv", CSV.encode(), "text/csv")},
        data={"mapping": json.dumps(MAPPING), "dry_run": "true"},
    )
    assert resp.status_code == 403
