"""XLSX results export: one worksheet per category."""

import io
import re

from openpyxl import Workbook

from app.services.ranking import ResultRow, format_elapsed

_INVALID_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")


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
