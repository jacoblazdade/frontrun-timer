// Participants: XLSX/CSV import with column mapping (dry run → report →
// commit), plus the list with inline edit and delete. Every field of a
// participant is editable here, including the race and the source; the rules
// that span participants (bib unique per event, Paarlauf group = same race +
// bib + group) are enforced server-side and reported inline on the row.
import { Check, Download, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  errorMessage,
  translateMessage,
  type ImportReport,
  type Participant,
  type ParticipantPage,
  type Race,
} from "../api";
import { AuthNotice, EventSelect, InfoBox, useConfirm } from "../components";
import { FileButton } from "../components/ui/file-button";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";
import { PAARLAUF_GENDER, paarlaufRace } from "../lib/paarlauf";

// Radix Select forbids empty-string item values; use a sentinel for "none".
const NONE = "__none__";

const GENDER_OPTIONS = [
  { value: "w", label: "w" },
  { value: "m", label: "m" },
  { value: "x", label: "x" },
];

const SOURCE_OPTIONS = [
  { value: "import", label: "Import" },
  { value: "day_of", label: "Nachmeldung" },
];

const SOURCE_LABEL: Record<Participant["source"], string> = {
  import: "Import",
  day_of: "Nachmeldung",
};

const CURRENT_YEAR = new Date().getFullYear();

/** Client-side check so obvious slips are caught before the round trip; the
 * server validates the same rules (and the ones spanning participants). */
function validate(p: Participant): string | null {
  if (!Number.isInteger(p.bib) || p.bib < 1) return "Startnummer muss eine ganze Zahl ab 1 sein.";
  if (!p.first_name.trim()) return "Vorname darf nicht leer sein.";
  if (!p.last_name.trim()) return "Nachname darf nicht leer sein.";
  if (p.birth_year !== null && (p.birth_year < 1900 || p.birth_year > CURRENT_YEAR))
    return `Jahrgang muss zwischen 1900 und ${CURRENT_YEAR} liegen.`;
  return null;
}

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
      .catch((err) => setError(errorMessage(err)));
  }, [file, upload]);

  const run = async (dryRun: boolean) => {
    try {
      const rep = await upload(dryRun, mapping);
      setReport(rep);
      setError(null);
      if (rep?.committed) onImported();
    } catch (err) {
      setError(errorMessage(err));
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
                    {e.row > 0 ? `Zeile ${e.row}: ` : ""}
                    {translateMessage(e.message)}
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

// Add another runner to a Paarlauf group: a new participant in the same race
// sharing the base runner's bib and pair_group (generated if the base had none
// yet). A group may hold two or more runners, so this can be repeated.
function AddPartnerForm({
  base,
  races,
  onDone,
  onCancel,
}: {
  base: Participant;
  races: Race[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState(base.last_name);
  const [birthYear, setBirthYear] = useState("");
  const [club, setClub] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A group is "same race + same bib", so the new member joins the base
  // runner's race — this form cannot move anyone. If that race is not the one
  // a Paarlauf belongs in, say so instead of quietly building a group in the
  // wrong race; moving a whole group is a deliberate edit.
  const pairRace = paarlaufRace(races);
  const wrongRace = pairRace !== null && base.race_id !== pairRace.id ? pairRace.name : null;

  const save = async () => {
    try {
      const pairGroup = base.pair_group ?? `p${base.bib}`;
      if (!base.pair_group) {
        // turn the base runner into one half of a pair — this also makes them
        // AllGender server-side, since a group ranks only as Paarlauf
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
          gender: PAARLAUF_GENDER,
          birth_year: birthYear ? Number(birthYear) : null,
          club: club || null,
          source: "day_of",
          registered: base.registered,
        }),
      });
      setError(null);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <tr>
      <td>{base.bib}</td>
      <td>
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", whiteSpace: "nowrap" }}
        >
          <span className="badge">Gruppe</span>
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
      <td title="Paarlauf wird immer als AllGender gewertet">{PAARLAUF_GENDER}</td>
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
      <td colSpan={3}>
        {error && <span className="error">{error}</span>}
        {!error && wrongRace && (
          <span className="hint">Hinweis: Paarlauf läuft normalerweise {wrongRace}.</span>
        )}
      </td>
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
  races,
  onChanged,
}: {
  participant: Participant;
  partners: Participant[];
  races: Race[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingPartner, setAddingPartner] = useState(false);
  const [draft, setDraft] = useState(participant);
  const [error, setError] = useState<string | null>(null);
  const raceName = races.find((r) => r.id === participant.race_id)?.name;
  // a group member has no own gender: the group ranks as AllGender
  const inPair = Boolean(draft.pair_group?.trim());

  // Ticking someone off saves straight away — at the desk this is one tap per
  // arrival, not an edit that has to be confirmed.
  const setRegistered = async (value: boolean) => {
    try {
      await api(`/api/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ registered: value }),
      });
      setError(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const startEditing = () => {
    setDraft(participant); // discard a previous, abandoned edit
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const invalid = validate(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      await api(`/api/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          race_id: draft.race_id,
          bib: draft.bib,
          first_name: draft.first_name.trim(),
          last_name: draft.last_name.trim(),
          // the server forces AllGender for a group; send it so the row does
          // not flash the old value before the reload
          gender: inPair ? PAARLAUF_GENDER : draft.gender,
          birth_year: draft.birth_year,
          club: draft.club?.trim() || null,
          pair_group: draft.pair_group?.trim() || null,
          source: draft.source,
          registered: draft.registered,
        }),
      });
      setEditing(false);
      setError(null);
      onChanged();
    } catch (e) {
      // the row stays in edit mode so the value can be corrected in place
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!window.confirm(`${participant.first_name} ${participant.last_name} löschen?`)) return;
    try {
      await api(`/api/participants/${participant.id}`, { method: "DELETE" });
      setError(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // group state for the badge: the other members, or a group marked but still
  // with no other member yet (the case the creator hit after an import)
  const partnerNames = partners.map((p) => `${p.first_name} ${p.last_name}`).join(", ");
  const pairBadge = partners.length
    ? `Gruppe mit ${partnerNames}`
    : participant.pair_group
      ? "Gruppe — Mitglied fehlt"
      : null;

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
          <td>{raceName ?? participant.race_id}</td>
          <td>{SOURCE_LABEL[participant.source] ?? participant.source}</td>
          <td>
            <input
              type="checkbox"
              checked={participant.registered}
              aria-label={`${participant.first_name} ${participant.last_name} ist da`}
              title="Abhaken, wenn die Person am Renntag da ist"
              onChange={(e) => setRegistered(e.target.checked)}
            />
          </td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="icon-button" aria-label="Bearbeiten" onClick={startEditing}>
              <Pencil size={16} />
            </button>{" "}
            {/* a Paarlauf group has no size cap, so a member can always be added */}
            <button
              className="icon-button"
              aria-label="Gruppenmitglied hinzufügen"
              title="Paarlauf-Gruppenmitglied hinzufügen"
              onClick={() => setAddingPartner((v) => !v)}
            >
              <UserPlus size={16} />
            </button>{" "}
            <button className="icon-button" aria-label="Löschen" onClick={remove}>
              <Trash2 size={16} />
            </button>
          </td>
        </tr>
        {error && (
          <tr>
            <td colSpan={9} className="error">
              {error}
            </td>
          </tr>
        )}
        {addingPartner && (
          <AddPartnerForm
            base={participant}
            races={races}
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
    <>
      <tr>
        <td>
          <input
            type="number"
            min={1}
            style={{ width: "5rem" }}
            aria-label="Startnummer"
            value={draft.bib}
            onChange={(e) => setDraft({ ...draft, bib: Number(e.target.value) })}
          />
        </td>
        <td>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <input
              value={draft.first_name}
              style={{ width: "7rem" }}
              aria-label="Vorname"
              onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
            />
            <input
              value={draft.last_name}
              style={{ width: "7rem" }}
              aria-label="Nachname"
              onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
            />
            <input
              placeholder="Paarlauf-Gruppe"
              title="Gleiche Gruppe + gleiche Startnummer + gleiches Rennen = ein Team (leer = kein Paarlauf)"
              style={{ width: "8rem" }}
              aria-label="Paarlauf-Gruppe"
              value={draft.pair_group ?? ""}
              onChange={(e) => setDraft({ ...draft, pair_group: e.target.value || null })}
            />
          </div>
        </td>
        <td>
          {/* a Paarlauf group ranks only as Paarlauf, so its members are
              AllGender — locked rather than hidden, so the value is visible */}
          <SelectField
            value={inPair ? PAARLAUF_GENDER : draft.gender}
            onValueChange={(v) => setDraft({ ...draft, gender: v as Participant["gender"] })}
            ariaLabel="Geschlecht"
            disabled={inPair}
            options={GENDER_OPTIONS}
          />
        </td>
        <td>
          <input
            type="number"
            style={{ width: "5rem" }}
            aria-label="Jahrgang"
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
            aria-label="Verein"
            onChange={(e) => setDraft({ ...draft, club: e.target.value || null })}
          />
        </td>
        <td>
          {/* only races of this event — a participant can never change event */}
          <SelectField
            className="w-32"
            value={String(draft.race_id)}
            onValueChange={(v) => setDraft({ ...draft, race_id: Number(v) })}
            ariaLabel="Rennen"
            options={races.map((r) => ({ value: String(r.id), label: r.name }))}
          />
        </td>
        <td>
          <SelectField
            className="w-36"
            value={draft.source}
            onValueChange={(v) => setDraft({ ...draft, source: v as Participant["source"] })}
            ariaLabel="Quelle"
            options={SOURCE_OPTIONS}
          />
        </td>
        <td>
          <input
            type="checkbox"
            checked={draft.registered}
            aria-label="Ist da"
            onChange={(e) => setDraft({ ...draft, registered: e.target.checked })}
          />
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="primary icon-button" aria-label="Speichern" onClick={save}>
            <Check size={16} />
          </button>{" "}
          <button
            className="icon-button"
            aria-label="Abbrechen"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            <X size={16} />
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={9} className="error">
            {error}
          </td>
        </tr>
      )}
    </>
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
  const [registeredTotal, setRegisteredTotal] = useState(0);
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
      setRegisteredTotal(d.registered_total);
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
  const races = event?.races ?? [];
  // total participants in the event (all races), independent of search/paging
  const eventTotal = races.reduce((s, r) => s + r.participant_count, 0);

  // Paarlauf group members share a race + bib; the backend keeps the whole
  // group on the same page, so grouping the current page shows every member.
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
        <strong>Paarlauf</strong> beim Teilnehmer auf <UserPlus size={13} /> tippen und weitere
        Mitglieder eintragen – alle teilen sich Startnummer und Paarlauf-Gruppe (zwei oder mehr)
        und werden als AllGender gewertet. In der Spalte <strong>Da</strong> am Renntag abhaken,
        wer erschienen ist.
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
        {eventTotal > 0 && eventId !== null && (
          // plain link, not fetch(): the browser handles the download (the
          // session cookie rides along) and the server names the file
          <a className="button icon-button" href={`/api/events/${eventId}/participants.xlsx`}>
            <Download size={15} /> Excel-Export
          </a>
        )}
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
              <th title="Am Renntag erschienen">Da</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <Row
                key={p.id}
                participant={p}
                partners={partnersOf(p)}
                races={races}
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
        {eventTotal > 0 && ` — ${registeredTotal} davon da`}
      </p>
    </div>
  );
}
