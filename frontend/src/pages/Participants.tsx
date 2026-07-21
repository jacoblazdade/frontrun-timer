// Participants: XLSX/CSV import with column mapping (dry run → report →
// commit), plus list with inline edit and delete.
import { Check, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type ImportReport, type Participant, type ParticipantPage } from "../api";
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
      <summary>Import (XLSX/Numbers/CSV)</summary>
      <div className="form-grid" style={{ marginTop: "0.75rem" }}>
        <FileButton accept=".xlsx,.numbers,.csv" onFile={onFile} />
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

// Add the second runner of a Paarlauf pair: a new participant in the same
// race sharing the base runner's bib and pair_group (generated if the base
// had none yet). The backend allows exactly this one shared-bib case.
function AddPartnerForm({
  base,
  onDone,
  onCancel,
}: {
  base: Participant;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState(base.last_name);
  const [gender, setGender] = useState<Participant["gender"]>("w");
  const [birthYear, setBirthYear] = useState("");
  const [club, setClub] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const pairGroup = base.pair_group ?? `p${base.bib}`;
      if (!base.pair_group) {
        // turn the base runner into one half of a pair
        await api(`/api/participants/${base.id}`, {
          method: "PATCH",
          body: JSON.stringify({ pair_group: pairGroup }),
        });
      }
      await api("/api/participants", {
        method: "POST",
        body: JSON.stringify({
          race_id: base.race_id,
          bib: base.bib,
          pair_group: pairGroup,
          first_name: first,
          last_name: last,
          gender,
          birth_year: birthYear ? Number(birthYear) : null,
          club: club || null,
          source: "day_of",
        }),
      });
      setError(null);
      onDone();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <tr>
      <td>{base.bib}</td>
      <td>
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", whiteSpace: "nowrap" }}
        >
          <span className="badge">Partner</span>
          <input
            placeholder="Vorname"
            value={first}
            style={{ width: "6.5rem" }}
            onChange={(e) => setFirst(e.target.value)}
          />
          <input
            placeholder="Nachname"
            value={last}
            style={{ width: "6.5rem" }}
            onChange={(e) => setLast(e.target.value)}
          />
        </div>
      </td>
      <td>
        <SelectField
          value={gender}
          onValueChange={(v) => setGender(v as Participant["gender"])}
          ariaLabel="Geschlecht"
          options={GENDER_OPTIONS}
        />
      </td>
      <td>
        <input
          type="number"
          style={{ width: "5rem" }}
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
        />
      </td>
      <td>
        <input
          placeholder="Verein"
          style={{ width: "7rem" }}
          value={club}
          onChange={(e) => setClub(e.target.value)}
        />
      </td>
      <td colSpan={2}>{error && <span className="error">{error}</span>}</td>
      <td>
        <button
          className="primary icon-button"
          aria-label="Partner speichern"
          disabled={!first || !last}
          onClick={save}
        >
          <Check size={16} />
        </button>{" "}
        <button className="icon-button" aria-label="Abbrechen" onClick={onCancel}>
          <X size={16} />
        </button>
      </td>
    </tr>
  );
}

function Row({
  participant,
  partners,
  raceNames,
  onChanged,
}: {
  participant: Participant;
  partners: Participant[];
  raceNames: Map<number, string>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingPartner, setAddingPartner] = useState(false);
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
          pair_group: draft.pair_group || null,
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

  // pairing state for the badge: a complete pair, or a pair marked but still
  // missing its partner (the case the creator hit after an import)
  const partnerNames = partners.map((p) => `${p.first_name} ${p.last_name}`).join(", ");
  const pairBadge = partners.length
    ? `Paar mit ${partnerNames}`
    : participant.pair_group
      ? "Paar — Partner fehlt"
      : null;
  // offer adding a partner while the bib is not yet a full pair
  const canAddPartner = partners.length === 0;

  if (!editing) {
    return (
      <>
        <tr>
          <td>{participant.bib}</td>
          <td>
            {participant.first_name} {participant.last_name}
            {pairBadge && (
              <span
                className={`badge${partners.length ? "" : " conflict"}`}
                style={{ marginLeft: "0.4rem" }}
              >
                {pairBadge}
              </span>
            )}
          </td>
          <td>{participant.gender}</td>
          <td>{participant.birth_year ?? ""}</td>
          <td>{participant.club ?? ""}</td>
          <td>{raceNames.get(participant.race_id) ?? participant.race_id}</td>
          <td>{participant.source}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="icon-button" aria-label="Bearbeiten" onClick={() => setEditing(true)}>
              <Pencil size={16} />
            </button>{" "}
            {canAddPartner && (
              <button
                className="icon-button"
                aria-label="Partner hinzufügen"
                title="Paarlauf-Partner hinzufügen"
                onClick={() => setAddingPartner((v) => !v)}
              >
                <UserPlus size={16} />
              </button>
            )}{" "}
            <button className="icon-button" aria-label="Löschen" onClick={remove}>
              <Trash2 size={16} />
            </button>
          </td>
        </tr>
        {addingPartner && (
          <AddPartnerForm
            base={participant}
            onDone={() => {
              setAddingPartner(false);
              onChanged();
            }}
            onCancel={() => setAddingPartner(false)}
          />
        )}
      </>
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
      <td colSpan={2}>
        <input
          placeholder="Paarlauf-Gruppe"
          title="Gleiche Gruppe = ein Paar (leer = kein Paarlauf)"
          style={{ width: "8rem" }}
          value={draft.pair_group ?? ""}
          onChange={(e) => setDraft({ ...draft, pair_group: e.target.value || null })}
        />
        {error && <span className="error"> {error}</span>}
      </td>
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
  const { events, error, reload: reloadEvents } = useAdminEvents();
  const PAGE_SIZE = 50;
  const [eventId, setEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState(""); // debounced value actually sent
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [dialog, confirm] = useConfirm();

  useEffect(() => {
    if (events.length > 0) setEventId((prev) => prev ?? events[0].id);
  }, [events]);

  // debounce the search box so we don't refetch on every keystroke
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(filter.trim()), 250);
    return () => window.clearTimeout(t);
  }, [filter]);

  // a new search or event starts back at the first page
  useEffect(() => setPage(0), [query, eventId]);

  const reloadPage = useCallback(() => {
    if (eventId === null) return;
    const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
    if (query) params.set("q", query);
    api<ParticipantPage>(`/api/events/${eventId}/participants?${params}`).then((d) => {
      setParticipants(d.items);
      setTotal(d.total);
      setPageCount(d.page_count);
      if (d.page !== page) setPage(d.page); // server clamped an out-of-range page
    });
  }, [eventId, page, query]);

  useEffect(reloadPage, [reloadPage]);

  // after a mutation refresh the page *and* the event list (its per-race
  // participant_count drives the total shown here and the delete button)
  const reload = useCallback(() => {
    reloadPage();
    reloadEvents();
  }, [reloadPage, reloadEvents]);

  const event = events.find((e) => e.id === eventId);
  const raceNames = new Map((event?.races ?? []).map((r) => [r.id, r.name]));
  // total participants in the event (all races), independent of search/paging
  const eventTotal = (event?.races ?? []).reduce((s, r) => s + r.participant_count, 0);

  // Paarlauf partners share a race + bib; the backend keeps both halves on the
  // same page, so grouping the current page is enough to show each partner.
  const byBib = new Map<string, Participant[]>();
  for (const p of participants) {
    const k = `${p.race_id}:${p.bib}`;
    (byBib.get(k) ?? byBib.set(k, []).get(k)!).push(p);
  }
  const partnersOf = (p: Participant) =>
    (byBib.get(`${p.race_id}:${p.bib}`) ?? []).filter((o) => o.id !== p.id);

  const clearAll = () => {
    confirm(
      `Wirklich ALLE ${eventTotal} Teilnehmer von ${event?.name ?? "diesem Event"} ` +
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
        E-Mail-Spalten werden aus Datenschutzgründen immer verworfen. Für einen{" "}
        <strong>Paarlauf</strong> beim Teilnehmer auf <UserPlus size={13} /> tippen und den Partner
        eintragen – beide teilen sich Startnummer und Paarlauf-Gruppe.
      </InfoBox>
      <p style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <EventSelect events={events} value={eventId} onChange={setEventId} />
      </p>
      {eventId !== null && <ImportPanel eventId={eventId} onImported={reload} />}
      <p
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "1.5rem",
        }}
      >
        <input
          placeholder="Suchen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {eventTotal > 0 && (
          <button className="danger" onClick={clearAll}>
            Alle löschen
          </button>
        )}
      </p>
      {pageCount > 1 && (
        <div className="pagination pagination--top">
          <button onClick={() => setPage(page - 1)} disabled={page === 0}>
            ← Zurück
          </button>
          <span>
            Seite {page + 1} von {pageCount}
          </span>
          <button onClick={() => setPage(page + 1)} disabled={page >= pageCount - 1}>
            Weiter →
          </button>
        </div>
      )}
      <div className="table-scroll">
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
            {participants.map((p) => (
              <Row
                key={p.id}
                participant={p}
                partners={partnersOf(p)}
                raceNames={raceNames}
                onChanged={reload}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p>
        {query
          ? `${total} Treffer für „${query}"`
          : `${eventTotal} Teilnehmer`}
      </p>
    </div>
  );
}
