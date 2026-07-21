"""Import: email columns silently dropped (never stored), dry-run commits
nothing, duplicate/missing bib validation, XLSX parsing."""

import io

from openpyxl import Workbook
from sqlalchemy import select, text

from app.models import Participant, Role
from app.services.importer import import_participants, parse_table
from tests.conftest import login, make_participant

CSV = (
    "Startnr;Vorname;Nachname;Geschlecht;Jahrgang;Verein;E-Mail\n"
    "1;Anna;Müller;w;1990;LG Nord;anna@example.com\n"
    "2;Max;Schmidt;m;1985;;max@example.com\n"
)

MAPPING = {
    "bib": "Startnr",
    "first_name": "Vorname",
    "last_name": "Nachname",
    "gender": "Geschlecht",
    "birth_year": "Jahrgang",
    "club": "Verein",
}


def test_email_column_is_dropped_and_never_stored(db, event, race5):
    rows = parse_table("import.csv", CSV.encode())
    # even a malicious/mistaken attempt to map the email column is ignored
    mapping = {**MAPPING, "club": "E-Mail"}
    result = import_participants(
        db, event, rows=rows, mapping=mapping, default_race_id=race5.id, dry_run=False
    )
    assert result.committed
    assert "E-Mail" in result.dropped_columns

    participants = db.scalars(select(Participant)).all()
    assert len(participants) == 2
    assert all(p.club != "anna@example.com" for p in participants)
    # no email anywhere in the participants table
    for row in db.execute(text("SELECT * FROM participants")).mappings():
        assert "@" not in " ".join(str(v) for v in row.values())


def test_dry_run_commits_nothing(db, event, race5):
    rows = parse_table("import.csv", CSV.encode())
    result = import_participants(
        db, event, rows=rows, mapping=MAPPING, default_race_id=race5.id, dry_run=True
    )
    assert result.valid_rows == 2
    assert not result.committed
    assert db.scalars(select(Participant)).all() == []


def test_shared_bib_auto_pairs_without_explicit_group(db, event, race5):
    # two runners on one bib in the same race → a Paarlauf pair, grouped for us
    csv_dup = "Startnr;Vorname;Nachname;Geschlecht\n1;A;B;w\n1;C;D;m\n"
    rows = parse_table("x.csv", csv_dup.encode())
    mapping = {"bib": "Startnr", "first_name": "Vorname", "last_name": "Nachname",
               "gender": "Geschlecht"}
    result = import_participants(
        db, event, rows=rows, mapping=mapping, default_race_id=race5.id, dry_run=False
    )
    assert result.errors == []
    assert result.created == 2
    pair = db.scalars(select(Participant).where(Participant.bib == 1)).all()
    groups = {p.pair_group for p in pair}
    assert len(groups) == 1 and next(iter(groups))  # both share one non-empty group


def test_third_runner_on_bib_fails_validation(db, event, race5):
    csv_trip = "Startnr;Vorname;Nachname;Geschlecht\n1;A;B;w\n1;C;D;m\n1;E;F;w\n"
    rows = parse_table("x.csv", csv_trip.encode())
    mapping = {"bib": "Startnr", "first_name": "Vorname", "last_name": "Nachname",
               "gender": "Geschlecht"}
    result = import_participants(
        db, event, rows=rows, mapping=mapping, default_race_id=race5.id, dry_run=False
    )
    assert not result.committed
    assert any("more than two runners" in e.message for e in result.errors)


def test_paarlauf_partners_may_share_bib_in_file(db, event, race5):
    csv_pair = (
        "Startnr;Vorname;Nachname;Geschlecht;Paar\n"
        "1;A;B;w;team-a\n"
        "1;C;D;m;team-a\n"
    )
    rows = parse_table("x.csv", csv_pair.encode())
    mapping = {
        "bib": "Startnr",
        "first_name": "Vorname",
        "last_name": "Nachname",
        "gender": "Geschlecht",
        "pair_group": "Paar",
    }
    result = import_participants(
        db, event, rows=rows, mapping=mapping, default_race_id=race5.id, dry_run=False
    )
    assert result.errors == []
    assert result.created == 2


def test_bib_clash_with_existing_event_participant(db, event, race5, race10):
    make_participant(db, race10, 1)
    rows = parse_table("import.csv", CSV.encode())
    result = import_participants(
        db, event, rows=rows, mapping=MAPPING, default_race_id=race5.id, dry_run=False
    )
    assert not result.committed
    assert any("already taken" in e.message for e in result.errors)


def test_missing_bib_and_invalid_gender_are_reported_per_row(db, event, race5):
    csv_bad = "Startnr;Vorname;Nachname;Geschlecht\n;A;B;w\n2;C;D;q\n"
    rows = parse_table("x.csv", csv_bad.encode())
    mapping = {"bib": "Startnr", "first_name": "Vorname", "last_name": "Nachname",
               "gender": "Geschlecht"}
    result = import_participants(
        db, event, rows=rows, mapping=mapping, default_race_id=race5.id, dry_run=True
    )
    assert len(result.errors) == 2
    assert result.errors[0].row == 2 and "bib" in result.errors[0].message
    assert result.errors[1].row == 3 and "gender" in result.errors[1].message


def test_xlsx_parsing_roundtrip(db, event, race5):
    wb = Workbook()
    ws = wb.active
    ws.append(["Startnr", "Vorname", "Nachname", "Geschlecht", "Email"])
    ws.append([1, "Anna", "Müller", "w", "a@example.com"])
    buf = io.BytesIO()
    wb.save(buf)

    rows = parse_table("import.xlsx", buf.getvalue())
    assert rows == [
        {"Startnr": "1", "Vorname": "Anna", "Nachname": "Müller", "Geschlecht": "w",
         "Email": "a@example.com"}
    ]
    result = import_participants(
        db,
        event,
        rows=rows,
        mapping={"bib": "Startnr", "first_name": "Vorname", "last_name": "Nachname",
                 "gender": "Geschlecht"},
        default_race_id=race5.id,
        dry_run=False,
    )
    assert result.committed and result.created == 1
    assert result.dropped_columns == ["Email"]


def test_numbers_parsing_roundtrip(db, event, race5, tmp_path):
    from numbers_parser import Document

    doc = Document()
    table = doc.sheets[0].tables[0]
    data = [
        ["Startnr", "Vorname", "Nachname", "Geschlecht", "E-Mail"],
        [1, "Anna", "Müller", "w", "a@example.com"],
    ]
    for r, row in enumerate(data):
        for c, val in enumerate(row):
            table.write(r, c, val)
    path = tmp_path / "import.numbers"
    doc.save(str(path))

    rows = parse_table("import.numbers", path.read_bytes())
    assert rows == [
        {"Startnr": "1", "Vorname": "Anna", "Nachname": "Müller", "Geschlecht": "w",
         "E-Mail": "a@example.com"}
    ]
    result = import_participants(
        db,
        event,
        rows=rows,
        mapping={"bib": "Startnr", "first_name": "Vorname", "last_name": "Nachname",
                 "gender": "Geschlecht"},
        default_race_id=race5.id,
        dry_run=False,
    )
    assert result.committed and result.created == 1
    assert result.dropped_columns == ["E-Mail"]


def test_import_endpoint_multipart(db, client, event, race5):
    login(client, db, Role.admin)
    import json

    resp = client.post(
        f"/api/events/{event.id}/import",
        files={"file": ("import.csv", CSV.encode(), "text/csv")},
        data={"mapping": json.dumps(MAPPING), "dry_run": "false",
              "default_race_id": str(race5.id)},
    )
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["committed"] is True
    assert report["created"] == 2
    assert report["dropped_columns"] == ["E-Mail"]


def test_report_lists_mappable_columns_in_file_order(db, event, race5):
    rows = parse_table("import.csv", CSV.encode())
    result = import_participants(db, event, rows=rows, mapping={}, dry_run=True)
    # email column excluded, original order preserved
    assert result.columns == ["Startnr", "Vorname", "Nachname", "Geschlecht", "Jahrgang", "Verein"]
