export interface Race {
  id: number;
  event_id: number;
  name: string;
  status: "pending" | "running" | "finished";
  started_at: string | null;
  finish_count: number;
  participant_count: number;
}

export const RACE_STATUS_LABEL: Record<Race["status"], string> = {
  pending: "Noch nicht gestartet",
  running: "Läuft",
  finished: "Beendet",
};

export interface EventInfo {
  id: number;
  name: string;
  date: string;
  is_published: boolean;
  races: Race[];
}

export interface BibTarget {
  bib: number;
  race_id: number;
  race_name: string;
  name: string;
}

export interface ResultRow {
  category: string;
  rank: number;
  bib: number;
  name: string;
  birth_year: number | null;
  club: string | null;
  elapsed_seconds: number;
  time: string;
  changed_at: string;
}

export interface ResultsOut {
  event_id: number;
  categories: string[];
  results: ResultRow[];
  server_time: string;
}

export interface FinishOut {
  id: number;
  race_id: number;
  race_name: string | null;
  bib: number | null;
  recorded_at: string;
  client_id: string;
  status: "ok" | "unassigned" | "voided" | "conflict";
  created_by: string;
  participant_name: string | null;
  elapsed_seconds: number | null;
}

export interface Participant {
  id: number;
  race_id: number;
  bib: number;
  first_name: string;
  last_name: string;
  gender: "m" | "w" | "x";
  birth_year: number | null;
  club: string | null;
  pair_group: string | null;
  source: "import" | "day_of";
}

export interface ParticipantPage {
  items: Participant[];
  total: number;
  page: number;
  page_count: number;
}

export interface ImportReport {
  total_rows: number;
  valid_rows: number;
  errors: { row: number; message: string }[];
  dropped_columns: string[];
  columns: string[];
  created: number;
  committed: boolean;
}

export interface ResultsImportReport extends ImportReport {
  races: string[]; // races the file touches
  started_races: string[]; // races that had no start time and got one
  voided: number; // finish records voided by "replace"
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FIELD_LABELS: Record<string, string> = {
  bib: "Startnummer",
  first_name: "Vorname",
  last_name: "Nachname",
  gender: "Geschlecht",
  birth_year: "Jahrgang",
  club: "Verein",
  pair_group: "Paarlauf-Gruppe",
  race_id: "Rennen",
  source: "Quelle",
  started_at: "Startzeit",
  name: "Name",
  date: "Datum",
};

interface ValidationError {
  type?: string;
  msg?: string;
  loc?: (string | number)[];
  ctx?: Record<string, unknown>;
}

/** German wording for one FastAPI/pydantic field error. */
function validationText(d: ValidationError): string {
  switch (d.type) {
    case "greater_than_equal":
      return `muss mindestens ${d.ctx?.ge} sein`;
    case "less_than_equal":
      return `darf höchstens ${d.ctx?.le} sein`;
    case "string_too_short":
      return "darf nicht leer sein";
    case "string_too_long":
      return `ist zu lang (max. ${d.ctx?.max_length} Zeichen)`;
    case "int_parsing":
    case "int_type":
    case "float_parsing":
      return "muss eine Zahl sein";
    case "missing":
      return "fehlt";
    case "enum":
      return `hat einen ungültigen Wert (erlaubt: ${d.ctx?.expected})`;
    default:
      return d.msg ?? "ist ungültig";
  }
}

// The API answers in English (its wording is asserted in the backend tests);
// the UI is German, so the translation lives here at the display edge. Covers
// both HTTP `detail` strings and the per-row messages of the two importers.
const SERVER_MESSAGES: [RegExp, (m: RegExpMatchArray) => string][] = [
  // --- bib conflicts (participant edit / both importers) ---
  [
    /^bib (\d+) is already taken in this event by (.+)$/,
    (m) => `Startnummer ${m[1]} ist in diesem Event schon vergeben (${m[2]}).`,
  ],
  [
    /^bib (\d+) is already taken in this event$/,
    (m) => `Startnummer ${m[1]} ist in diesem Event schon vergeben.`,
  ],
  [
    /^bib (\d+) is shared with the Paarlauf group \((.+)\); give this runner a free bib/,
    (m) =>
      `Startnummer ${m[1]} wird mit der Paarlauf-Gruppe geteilt (${m[2]}). ` +
      "Zum Verlassen der Gruppe im selben Schritt eine freie Startnummer vergeben.",
  ],
  [
    /^bib (\d+) is shared with the Paarlauf group \((.+)\) in another race/,
    (m) =>
      `Startnummer ${m[1]} gehört der Paarlauf-Gruppe (${m[2]}). ` +
      "Entweder die ganze Gruppe umtragen oder dieser Person eine freie Startnummer geben.",
  ],
  [
    /^bib (\d+) is used in two different races$/,
    (m) => `Startnummer ${m[1]} steht in der Datei bei zwei verschiedenen Rennen.`,
  ],
  [
    /^bib (\d+) appears twice \(also in row (\d+)\)$/,
    (m) => `Startnummer ${m[1]} kommt mehrfach vor (schon in Zeile ${m[2]}).`,
  ],
  [
    /^bib (\d+) is not registered in this event/,
    (m) => `Startnummer ${m[1]} ist in diesem Event nicht gemeldet — Teilnehmer zuerst anlegen.`,
  ],
  [
    /^bib (\d+) already has a finish time in the app/,
    (m) =>
      `Startnummer ${m[1]} hat in der App schon eine Zeit — „Ersetzen“ wählen ` +
      "oder die Zeile aus der Datei entfernen.",
  ],
  // --- row validation (both importers) ---
  [/^mapping for '(\w+)' is missing$/, (m) => `Spalte für ${FIELD_LABELS[m[1]] ?? m[1]} fehlt.`],
  [/^invalid bib (.+)$/, (m) => `ungültige Startnummer ${m[1]}`],
  [
    /^invalid time (.+) \(use H:MM:SS or MM:SS\)$/,
    (m) => `ungültige Laufzeit ${m[1]} — erwartet wird H:MM:SS oder MM:SS`,
  ],
  [/^invalid birth_year (.+)$/, (m) => `ungültiger Jahrgang ${m[1]}`],
  [
    /^invalid gender (.+) \(use m\/w\/x\)$/,
    (m) => `ungültiges Geschlecht ${m[1]} — erlaubt sind m, w oder x`,
  ],
  [
    /^first_name and last_name are required$/,
    () => "Vor- und Nachname sind Pflichtfelder.",
  ],
  [/^unknown race (.+) for this event$/, (m) => `Rennen ${m[1]} gibt es in diesem Event nicht.`],
  [
    /^no race column mapped and no default_race_id given$/,
    () => "Kein Rennen zugeordnet — Spalte „Rennen“ wählen oder ein Rennen für alle Zeilen setzen.",
  ],
  [
    /^default_race_id is not a race of this event$/,
    () => "Das gewählte Rennen gehört nicht zu diesem Event.",
  ],
  // --- plain endpoint errors ---
  [
    /^race '(.+)' belongs to another event/,
    (m) => `Das Rennen „${m[1]}" gehört zu einem anderen Event — das Event lässt sich nicht wechseln.`,
  ],
  [/^(\w+) must not be empty$/, (m) => `${FIELD_LABELS[m[1]] ?? m[1]} darf nicht leer sein.`],
  [/^participant not found$/, () => "Teilnehmer nicht gefunden — inzwischen gelöscht?"],
  [/^race not found$/, () => "Rennen nicht gefunden."],
  [/^event not found$/, () => "Event nicht gefunden."],
  [/^admin only$/, () => "Nur für Administratoren."],
  [/^not authenticated$/, () => "Nicht angemeldet — bitte neu einloggen."],
];

/** German wording for a message the API produced, or the message unchanged if
 * it isn't one we know. Used for import row errors as well as HTTP details. */
export function translateMessage(text: string): string {
  const trimmed = text.trim();
  for (const [pattern, render] of SERVER_MESSAGES) {
    const match = trimmed.match(pattern);
    if (match) return render(match);
  }
  return trimmed;
}

/** Readable German text for anything thrown by `api()`. Unpacks FastAPI's
 * `{"detail": …}` body, including the field-error list of a 422. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e);

  let detail: unknown;
  try {
    detail = (JSON.parse(e.message) as { detail?: unknown }).detail;
  } catch {
    detail = e.message; // not JSON (a proxy error page, say)
  }

  if (Array.isArray(detail)) {
    return (detail as ValidationError[])
      .map((d) => {
        const field = String(d.loc?.[d.loc.length - 1] ?? "");
        return `${FIELD_LABELS[field] ?? field} ${validationText(d)}`;
      })
      .join(" · ");
  }

  const text = String(detail ?? "").trim();
  return translateMessage(text) || `Fehler ${e.status}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** local datetime string for <input type="datetime-local"> */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
