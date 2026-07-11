// Participants: XLSX/CSV import with column mapping (dry run → report →
// commit), plus list with inline edit and delete.
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type ImportReport, type Participant } from "../api";
import { AuthNotice, EventSelect, InfoBox, useConfirm } from "../components";
import { FileButton } from "../components/ui/file-button";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";

// Radix Select forbids empty-string item values; use a sentinel for "none".
const NONE = "__none__";

const GENDER_OPTIONS = [
  { value: "w", label: "w" },
  { value: "m", label: "m" },
  { value: "x", label: "x" },
];

const FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "bib", label: "Startnummer", required: true },
  { key: "first_name", label: "Vorname", required: true },
  { key: "last_name", label: "Nachname", required: true },
  { key: "gender", label: "Geschlecht", required: true },
  { key: "birth_year", label: "Jahrgang", required: false },
  { key: "club", label: "Verein", required: false },
  { key: "pair_group", label: "Paarlauf-Gruppe", required: false },
  { key: "race", label: "Rennen", required: false },
];

// guess a column for each field from common German/English headers
const GUESSES: Record<string, RegExp> = {
  bib: /startn|bib|nr/i,
  first_name: /vorname|first/i,
  last_name: /nachname|last|name/i,
  gender: /geschlecht|gender|sex/i,
  birth_year: /jahrgang|geb|birth|year/i,
  club: /verein|club|team/i,
  pair_group: /paar|pair/i,
  race: /rennen|strecke|race|distanz/i,
};

function ImportPanel({ eventId, onImported }: { eventId: number; onImported: () => void }) {
  const { events } = useAdminEvents();
  const event = events.find((e) => e.id === eventId);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultRaceId, setDefaultRaceId] = useState<number | "">("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (dryRun: boolean, useMapping: Record<string, string>) => {
      if (!file) return null;
      const body = new FormData();
      body.append("file", file);
      body.append("mapping", JSON.stringify(useMapping));
      body.append("dry_run", String(dryRun));
      if (defaultRaceId !== "") body.append("default_race_id", String(defaultRaceId));
      const res = await fetch(`/api/events/${eventId}/import`, { method: "POST", body });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ImportReport;
    },
    [file, eventId, defaultRaceId]
  );

  // on file choice: dry-run once only to discover the columns and prefill
  // the mapping — its report (always "mapping missing") is not shown
  const onFile = (f: File | null) => {
    setFile(f);
    setReport(null);
    setColumns([]);
    setMapping({});
  };

  useEffect(() => {
    if (!file) return;
    upload(true, {})
      .then((rep) => {
        if (!rep) return;
        const guessed: Record<string, string> = {};
        for (const { key } of FIELDS) {
          const hit = rep.columns.find(
            (c) => GUESSES[key]?.test(c) && !Object.values(guessed).includes(c)
          );
          if (hit) guessed[key] = hit;
        }
        setMapping(guessed);
        setColumns(rep.columns);
        setError(null);
      })
      .catch((err) => setError(String(err)));
  }, [file, upload]);

  const run = async (dryRun: boolean) => {
    try {
      const rep = await upload(dryRun, mapping);
      setReport(rep);
      setError(null);
      if (rep?.committed) onImported();
    } catch (err) {
      setError(String(err));
    }
  };

  const canCommit =
    report !== null && !report.committed && report.errors.length === 0 && report.valid_rows > 0;

  return (
    <details>
      <summary>Import (XLSX/CSV)</summary>
      <div className="form-grid" style={{ marginTop: "0.75rem" }}>
        <FileButton accept=".xlsx,.csv" onFile={onFile} />
        {columns.length > 0 && (
          <>
            {FIELDS.map(({ key, label, required }) => (
              <div key={key} className="map-field">
                <span className="map-field-label">
                  {label}
                  {required ? " *" : ""}
                </span>
                <SelectField
                  value={mapping[key] ?? NONE}
                  onValueChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (v && v !== NONE) next[key] = v;
                      else delete next[key];
                      return next;
                    })
                  }
                  ariaLabel={label}
                  options={[
                    { value: NONE, label: "— keine Spalte —" },
                    ...columns.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </div>
            ))}
            {!mapping.race && (
              <div className="map-field">
                <span className="map-field-label">Rennen (für alle Zeilen)</span>
                <SelectField
                  value={defaultRaceId === "" ? NONE : String(defaultRaceId)}
                  onValueChange={(v) => setDefaultRaceId(v === NONE ? "" : Number(v))}
                  ariaLabel="Rennen für alle Zeilen"
                  options={[
                    { value: NONE, label: "— wählen —" },
                    ...(event?.races ?? []).map((r) => ({ value: String(r.id), label: r.name })),
                  ]}
                />
              </div>
            )}
            <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => run(true)}>1. Prüfen (Dry-Run)</button>
              <button className="primary" onClick={() => run(false)} disabled={!canCommit}>
                2. Importieren
              </button>
              {!canCommit && !report?.committed && (
                <small>
                  {report === null
                    ? "erst prüfen — Importieren wird danach freigeschaltet"
                    : report.errors.length > 0
                      ? "Fehler beheben, dann erneut prüfen"
                      : "keine gültigen Zeilen"}
                </small>
              )}
            </span>
          </>
        )}
        {error && <p className="error">{error}</p>}
        {report && (
          <div>
            <p>
              {report.total_rows} Zeilen, {report.valid_rows} gültig
              {report.dropped_columns.length > 0 &&
                ` — E-Mail-Spalten verworfen: ${report.dropped_columns.join(", ")}`}
              {report.committed && ` — ${report.created} importiert ✓`}
            </p>
            {report.errors.length > 0 && (
              <ul className="error">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    Zeile {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function Row({
  participant,
  raceNames,
  onChanged,
}: {
  participant: Participant;
  raceNames: Map<number, string>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api(`/api/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          bib: draft.bib,
          first_name: draft.first_name,
          last_name: draft.last_name,
          gender: draft.gender,
          birth_year: draft.birth_year,
          club: draft.club,
        }),
      });
      setEditing(false);
      setError(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async () => {
    if (!window.confirm(`${participant.first_name} ${participant.last_name} löschen?`)) return;
    await api(`/api/participants/${participant.id}`, { method: "DELETE" });
    onChanged();
  };

  if (!editing) {
    return (
      <tr>
        <td>{participant.bib}</td>
        <td>
          {participant.first_name} {participant.last_name}
          {participant.pair_group && <span className="badge"> Paar</span>}
        </td>
        <td>{participant.gender}</td>
        <td>{participant.birth_year ?? ""}</td>
        <td>{participant.club ?? ""}</td>
        <td>{raceNames.get(participant.race_id) ?? participant.race_id}</td>
        <td>{participant.source}</td>
        <td>
          <button className="icon-button" aria-label="Bearbeiten" onClick={() => setEditing(true)}>
            <Pencil size={16} />
          </button>{" "}
          <button className="icon-button" aria-label="Löschen" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        <input
          type="number"
          style={{ width: "5rem" }}
          value={draft.bib}
          onChange={(e) => setDraft({ ...draft, bib: Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          value={draft.first_name}
          style={{ width: "7rem" }}
          onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
        />{" "}
        <input
          value={draft.last_name}
          style={{ width: "7rem" }}
          onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
        />
      </td>
      <td>
        <SelectField
          value={draft.gender}
          onValueChange={(v) => setDraft({ ...draft, gender: v as Participant["gender"] })}
          ariaLabel="Geschlecht"
          options={GENDER_OPTIONS}
        />
      </td>
      <td>
        <input
          type="number"
          style={{ width: "5rem" }}
          value={draft.birth_year ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, birth_year: e.target.value ? Number(e.target.value) : null })
          }
        />
      </td>
      <td>
        <input
          value={draft.club ?? ""}
          style={{ width: "8rem" }}
          onChange={(e) => setDraft({ ...draft, club: e.target.value || null })}
        />
      </td>
      <td colSpan={2}>{error && <span className="error">{error}</span>}</td>
      <td>
        <button className="primary icon-button" aria-label="Speichern" onClick={save}>
          <Check size={16} />
        </button>{" "}
        <button className="icon-button" aria-label="Abbrechen" onClick={() => setEditing(false)}>
          <X size={16} />
        </button>
      </td>
    </tr>
  );
}

export default function Participants() {
  const { events, error } = useAdminEvents();
  const [eventId, setEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [filter, setFilter] = useState("");
  const [dialog, confirm] = useConfirm();

  useEffect(() => {
    if (events.length > 0) setEventId((prev) => prev ?? events[0].id);
  }, [events]);

  const reload = useCallback(() => {
    if (eventId === null) return;
    api<Participant[]>(`/api/events/${eventId}/participants`).then(setParticipants);
  }, [eventId]);

  useEffect(reload, [reload]);

  const event = events.find((e) => e.id === eventId);
  const raceNames = new Map((event?.races ?? []).map((r) => [r.id, r.name]));
  const shown = participants.filter((p) =>
    `${p.bib} ${p.first_name} ${p.last_name} ${p.club ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  );

  const clearAll = () => {
    const event = events.find((e) => e.id === eventId);
    confirm(
      `Wirklich ALLE ${participants.length} Teilnehmer von ${event?.name ?? "diesem Event"} ` +
        "unwiderruflich löschen? Gedacht für den Neuimport einer Meldeliste.",
      async () => {
        await api(`/api/events/${eventId}/participants`, { method: "DELETE" });
        reload();
      }
    );
  };

  return (
    <div>
      <h1>Teilnehmer</h1>
      {dialog}
      <AuthNotice error={error} />
      <InfoBox id="participants">
        Meldeliste importieren oder Teilnehmer einzeln bearbeiten. Import in drei Schritten:{" "}
        <strong>Datei wählen</strong> → <strong>Prüfen (Dry-Run)</strong> zeigt einen Bericht →{" "}
        <strong>Importieren</strong>. Spalten werden automatisch zugeordnet (korrigierbar);
        E-Mail-Spalten werden aus Datenschutzgründen immer verworfen.
      </InfoBox>
      <p style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <EventSelect events={events} value={eventId} onChange={setEventId} />
        <input
          placeholder="Suchen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {participants.length > 0 && (
          <button className="danger" onClick={clearAll}>
            Alle löschen
          </button>
        )}
      </p>
      {eventId !== null && <ImportPanel eventId={eventId} onImported={reload} />}
      <div className="table-scroll" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Name</th>
              <th>G</th>
              <th>Jg.</th>
              <th>Verein</th>
              <th>Rennen</th>
              <th>Quelle</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <Row key={p.id} participant={p} raceNames={raceNames} onChanged={reload} />
            ))}
          </tbody>
        </table>
      </div>
      <p>{shown.length} von {participants.length} Teilnehmern</p>
    </div>
  );
}
