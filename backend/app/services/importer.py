"""Participant import from XLSX/Numbers/CSV with column mapping.

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
    "a": Gender.x,
    "d": Gender.x,
    "divers": Gender.x,
    "all gender": Gender.x,
    "allgender": Gender.x,
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


def looks_like_email(column: str) -> bool:
    c = column.strip().lower()
    return "mail" in c or "@" in c


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))  # XLSX numbers come back as floats
    return str(value).strip()


def _rows_to_dicts(rows) -> list[dict[str, str]]:
    """Turns an iterable of cell-tuples (first row = header) into dicts.

    Headerless columns are dropped — Numbers/XLSX sheets often carry trailing
    empty columns, and a column with no header can't be mapped anyway.
    """
    rows = iter(rows)
    try:
        headers = [_cell(h) for h in next(rows)]
    except StopIteration:
        return []
    keep = [(i, h) for i, h in enumerate(headers) if h]
    result = []
    for row in rows:
        cells = [_cell(v) for v in row]
        if not any(cells):
            continue
        result.append({h: cells[i] if i < len(cells) else "" for i, h in keep})
    return result


def parse_table(filename: str, content: bytes) -> list[dict[str, str]]:
    """Parses XLSX, Apple Numbers, or CSV into a list of {header: cell} dicts."""
    name = filename.lower()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        return _rows_to_dicts(ws.iter_rows(values_only=True))

    if name.endswith(".numbers"):
        import tempfile

        from numbers_parser import Document, FileFormatError

        # numbers-parser reads from a path, not a buffer; a .numbers doc is a
        # zip package. Use the first table of the first sheet.
        with tempfile.NamedTemporaryFile(suffix=".numbers") as tmp:
            tmp.write(content)
            tmp.flush()
            try:
                doc = Document(tmp.name)
                tables = doc.sheets[0].tables
            except (FileFormatError, IndexError, KeyError, ValueError) as e:
                raise ImportFormatError(f"could not read Numbers file: {e}") from e
            if not tables:
                return []
            return _rows_to_dicts(tables[0].rows(values_only=True))

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
    result.dropped_columns = sorted(c for c in all_columns if looks_like_email(c))
    result.columns = [c for c in all_columns if not looks_like_email(c)]

    mapping = {
        f: col
        for f, col in mapping.items()
        if f in IMPORT_FIELDS and not looks_like_email(col) and not looks_like_email(f)
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
    # bib -> (race_id, [participants]) already claiming it in this file
    file_bibs: dict[int, tuple[int, list[Participant]]] = {}

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
                RowError(row=idx, message=f"invalid gender {get('gender')!r} (use m/w/x, a)")
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

        # A bib may repeat within a race as a Paarlauf group: two or more
        # runners sharing one bib. Extra rows are accepted automatically and the
        # group is formed for us (honouring an explicit Paarlauf-Gruppe, else
        # deriving one). The same bib in another race is still an error.
        existing = file_bibs.get(bib)
        if existing is not None:
            prev_race_id, members = existing
            if prev_race_id != race.id:
                result.errors.append(
                    RowError(row=idx, message=f"bib {bib} is used in two different races")
                )
                continue

        # clash with participants already saved in the event (e.g. a prior import)
        try:
            assert_bib_available(db, event.id, bib, race_id=race.id, pair_group=pair_group)
        except BibConflictError as e:
            result.errors.append(RowError(row=idx, message=str(e)))
            continue

        participant = Participant(
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
        result.valid_rows += 1
        to_create.append(participant)

        if existing is None:
            file_bibs[bib] = (race.id, [participant])
        else:
            members = existing[1]
            members.append(participant)
            # every member of a group must share one non-empty group so they
            # rank as a single Paarlauf place
            group = members[0].pair_group or pair_group or f"bib{bib}"
            for m in members:
                m.pair_group = group

    if not result.errors and not dry_run:
        db.add_all(to_create)
        db.flush()
        result.created = len(to_create)
        result.committed = True
    return result
