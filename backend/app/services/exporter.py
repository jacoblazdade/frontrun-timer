"""XLSX exports: results (one worksheet per category) and the participant list.

The participant export uses the column headers the importer recognises
(`services/importer.py` guesses them automatically), so an exported list can be
edited and imported straight back — into the same event or next year's.

The privacy rule holds here too: there is no email column to export.
"""

import io
import re

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.models import Participant, ParticipantSource
from app.services.ranking import ResultRow, format_elapsed

_INVALID_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")

SOURCE_LABEL = {
    ParticipantSource.imported: "Import",
    ParticipantSource.day_of: "Nachmeldung",
}

# (header, column width) — the headers double as import column names
PARTICIPANT_COLUMNS = [
    ("Startnummer", 13),
    ("Vorname", 18),
    ("Nachname", 20),
    ("Geschlecht", 11),
    ("Jahrgang", 10),
    ("Verein", 22),
    ("Paarlauf-Gruppe", 17),
    ("Rennen", 12),
    ("Quelle", 13),
]


def _sheet_title(name: str) -> str:
    return _INVALID_SHEET_CHARS.sub("-", name)[:31]


def results_workbook(results: list[ResultRow]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)

    by_category: dict[str, list[ResultRow]] = {}
    for row in results:
        by_category.setdefault(row.category, []).append(row)

    if not by_category:
        wb.create_sheet("Results").append(["No results yet"])

    for category, rows in by_category.items():
        ws = wb.create_sheet(_sheet_title(category))
        ws.append(["Platz", "Startnr.", "Name", "Jahrgang", "Verein", "Zeit"])
        for r in rows:
            ws.append(
                [r.rank, r.bib, r.name, r.birth_year, r.club, format_elapsed(r.elapsed_seconds)]
            )

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def participants_workbook(participants: list[Participant], race_names: dict[int, str]) -> bytes:
    """The complete participant list of an event, one row per person.

    Paarlauf members share a bib and are kept next to each other (the caller
    orders by bib), each with their own row — same shape the importer reads.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Teilnehmer"

    ws.append([header for header, _ in PARTICIPANT_COLUMNS])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for i, (_, width) in enumerate(PARTICIPANT_COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"  # header stays put while scrolling a long list

    for p in participants:
        ws.append(
            [
                p.bib,
                p.first_name,
                p.last_name,
                p.gender.value,
                p.birth_year,
                p.club,
                p.pair_group,
                race_names.get(p.race_id, ""),
                SOURCE_LABEL.get(p.source, str(p.source)),
            ]
        )

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
