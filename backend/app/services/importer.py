"""Participant import from XLSX/CSV with column mapping.

Privacy rule: email addresses are NEVER stored. Any column whose name looks
like an email column ('@' or 'mail' in the header) is silently dropped —
even if the caller tries to map it — and listed in `dropped_columns`.

Semantics: the import is all-or-nothing. If any row has an error, nothing is
committed and the report explains what to fix. With dry_run=True nothing is
ever committed; the report is the validation result to show before importing.
"""

import csv
import io
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models import Event, Gender, Participant, ParticipantSource

IMPORT_FIELDS = {
    "bib",
    "first_name",
    "last_name",
    "gender",
    "birth_year",
    "club",
    "pair_group",
    "race",
}

GENDER_ALIASES = {
    "m": Gender.m,
    "male": Gender.m,
    "mann": Gender.m,
    "männlich": Gender.m,
    "w": Gender.w,
    "f": Gender.w,
    "female": Gender.w,
    "frau": Gender.w,
    "weiblich": Gender.w,
    "x": Gender.x,
    "d": Gender.x,
    "divers": Gender.x,
}


class ImportFormatError(ValueError):
    pass


@dataclass
class RowError:
    row: int
    message: str


@dataclass
class ImportResult:
    total_rows: int = 0
    valid_rows: int = 0
    errors: list[RowError] = field(default_factory=list)
    dropped_columns: list[str] = field(default_factory=list)
    # mappable columns found in the file (email columns excluded) — lets the
    # UI offer a column-mapping dropdown after a first dry run
    columns: list[str] = field(default_factory=list)
    created: int = 0
    committed: bool = False


def _looks_like_email(column: str) -> bool:
    c = column.strip().lower()
    return "mail" in c or "@" in c


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))  # XLSX numbers come back as floats
    return str(value).strip()


def parse_table(filename: str, content: bytes) -> list[dict[str, str]]:
    """Parses XLSX or CSV into a list of {header: cell} dicts."""
    if filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = ws.iter_rows(values_only=True)
        try:
            headers = [_cell(h) for h in next(rows)]
        except StopIteration:
            return []
        return [
            dict(zip(headers, (_cell(v) for v in row), strict=False))
            for row in rows
            if any(_cell(v) for v in row)
        ]

    text = content.decode("utf-8-sig")
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t")
    except (csv.Error, IndexError):
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    return [
        {k: (v or "").strip() for k, v in row.items() if k is not None}
        for row in reader
        if any((v or "").strip() for v in row.values() if v is not None)
    ]


def import_participants(
    db: Session,
    event: Event,
    *,
    rows: list[dict[str, str]],
    mapping: dict[str, str],
    default_race_id: int | None = None,
    dry_run: bool = True,
) -> ImportResult:
    """`mapping` maps import field name -> source column header."""
    result = ImportResult(total_rows=len(rows))

    all_columns: dict[str, None] = {}  # dict keeps the file's column order
    for row in rows:
        all_columns.update(dict.fromkeys(row.keys()))
    result.dropped_columns = sorted(c for c in all_columns if _looks_like_email(c))
    result.columns = [c for c in all_columns if not _looks_like_email(c)]

    mapping = {
        f: col
        for f, col in mapping.items()
        if f in IMPORT_FIELDS and not _looks_like_email(col) and not _looks_like_email(f)
    }
    for required in ("bib", "first_name", "last_name", "gender"):
        if required not in mapping:
            result.errors.append(RowError(row=0, message=f"mapping for '{required}' is missing"))
            return result

    races_by_name = {r.name.strip().lower(): r for r in event.races}
    races_by_id = {r.id: r for r in event.races}
    if default_race_id is not None and default_race_id not in races_by_id:
        result.errors.append(RowError(row=0, message="default_race_id is not a race of this event"))
        return result

    from app.services.participants import BibConflictError, assert_bib_available

    to_create: list[Participant] = []
    # bib -> (race_id, pair_group, count) of rows already claiming it in this file
    file_bibs: dict[int, tuple[int, str | None, int]] = {}

    for idx, raw in enumerate(rows, start=2):  # row 1 is the header
        def get(fieldname: str, row=raw) -> str:
            col = mapping.get(fieldname)
            return row.get(col, "").strip() if col else ""

        errors_before = len(result.errors)

        bib_raw = get("bib")
        bib = None
        try:
            bib = int(float(bib_raw))
        except ValueError:
            result.errors.append(RowError(row=idx, message=f"invalid bib {bib_raw!r}"))

        first_name, last_name = get("first_name"), get("last_name")
        if not first_name or not last_name:
            result.errors.append(RowError(row=idx, message="first_name and last_name are required"))

        gender = GENDER_ALIASES.get(get("gender").lower())
        if gender is None:
            result.errors.append(
                RowError(row=idx, message=f"invalid gender {get('gender')!r} (use m/w/x)")
            )

        birth_year = None
        if get("birth_year"):
            try:
                birth_year = int(float(get("birth_year")))
            except ValueError:
                result.errors.append(
                    RowError(row=idx, message=f"invalid birth_year {get('birth_year')!r}")
                )

        race = None
        if get("race"):
            race = races_by_name.get(get("race").lower())
            if race is None:
                result.errors.append(
                    RowError(row=idx, message=f"unknown race {get('race')!r} for this event")
                )
        elif default_race_id is not None:
            race = races_by_id[default_race_id]
        else:
            result.errors.append(
                RowError(row=idx, message="no race column mapped and no default_race_id given")
            )

        pair_group = get("pair_group") or None

        if len(result.errors) > errors_before:
            continue

        # duplicate bibs inside the file (Paarlauf partner is the one allowed case)
        if bib in file_bibs:
            prev_race_id, prev_pair, count = file_bibs[bib]
            if not (
                pair_group and count == 1 and prev_race_id == race.id and prev_pair == pair_group
            ):
                result.errors.append(RowError(row=idx, message=f"duplicate bib {bib} in file"))
                continue
            file_bibs[bib] = (prev_race_id, prev_pair, count + 1)
        else:
            file_bibs[bib] = (race.id, pair_group, 1)

        # duplicate bibs against participants already in the event
        try:
            assert_bib_available(db, event.id, bib, race_id=race.id, pair_group=pair_group)
        except BibConflictError as e:
            result.errors.append(RowError(row=idx, message=str(e)))
            continue

        result.valid_rows += 1
        to_create.append(
            Participant(
                race_id=race.id,
                bib=bib,
                first_name=first_name,
                last_name=last_name,
                gender=gender,
                birth_year=birth_year,
                club=get("club") or None,
                pair_group=pair_group,
                source=ParticipantSource.imported,
            )
        )

    if not result.errors and not dry_run:
        db.add_all(to_create)
        db.flush()
        result.created = len(to_create)
        result.committed = True
    return result
