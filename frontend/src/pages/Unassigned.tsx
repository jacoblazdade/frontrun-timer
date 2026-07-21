// Assign bibs to finish records logged without a readable number, and
// resolve conflicts (two finishes for the same bib — one must be voided or
// moved to the right bib).
//
// Scope is the whole EVENT, not a single race: the finish line needs no race
// picker, so an open finish isn't tied to a race yet. Assigning a bib routes
// the finish to that bib's race server-side (bibs are unique per event).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatClock, type BibTarget, type FinishOut } from "../api";
import { AuthNotice, EventSelect, InfoBox } from "../components";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";

type SortKey = "time" | "bib" | "status";

const SORT_OPTIONS = [
  { value: "time", label: "Zeit" },
  { value: "bib", label: "Startnr." },
  { value: "status", label: "Status" },
];

function AssignRow({
  finish,
  bibMap,
  onChanged,
}: {
  finish: FinishOut;
  bibMap: Map<number, BibTarget>;
  onChanged: () => void;
}) {
  const [bib, setBib] = useState("");
  const [error, setError] = useState<string | null>(null);

  // name/race preview straight from the event's bib map (no per-bib request)
  const target = bib ? bibMap.get(parseInt(bib, 10)) ?? null : null;
  const preview = !bib
    ? null
    : target
      ? `${target.name} · ${target.race_name}`
      : "⚠︎ unbekannte Startnummer in diesem Event";

  const assign = async () => {
    try {
      await api(`/api/finishes/${finish.id}`, {
        method: "PATCH",
        body: JSON.stringify({ bib: parseInt(bib, 10) }),
      });
      setError(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const voidIt = async () => {
    if (!window.confirm("Diesen Zieleinlauf stornieren?")) return;
    await api(`/api/finishes/${finish.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "voided" }),
    });
    onChanged();
  };

  return (
    <li>
      <span className="bib">{finish.bib ?? "?"}</span>
      <span className={`badge ${finish.status}`}>{finish.status}</span>
      <span>
        {finish.elapsed_seconds != null
          ? formatClock(finish.elapsed_seconds)
          : new Date(finish.recorded_at).toLocaleTimeString()}
      </span>
      <span style={{ flex: 1 }}>{finish.participant_name ?? ""}</span>
      <input
        type="number"
        placeholder="Startnr."
        style={{ width: "6rem" }}
        value={bib}
        onChange={(e) => setBib(e.target.value)}
      />
      {preview && <span>{preview}</span>}
      <button className="primary" onClick={assign} disabled={!bib}>
        Zuordnen
      </button>
      <button onClick={voidIt}>Stornieren</button>
      {error && <span className="error">{error}</span>}
    </li>
  );
}

export default function Unassigned() {
  const { events, error } = useAdminEvents();
  const [eventId, setEventId] = useState<number | null>(null);
  const [finishes, setFinishes] = useState<FinishOut[]>([]);
  const [bibMap, setBibMap] = useState<Map<number, BibTarget>>(new Map());
  const [sort, setSort] = useState<SortKey>("time");

  useEffect(() => {
    if (events.length > 0 && eventId === null) setEventId(events[0].id);
  }, [events, eventId]);

  const reload = useCallback(() => {
    if (eventId === null) return;
    api<FinishOut[]>(`/api/events/${eventId}/finishes?limit=500`).then(setFinishes);
    api<BibTarget[]>(`/api/events/${eventId}/bibs`)
      .then((targets) => setBibMap(new Map(targets.map((t) => [t.bib, t]))))
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  const open = useMemo(() => {
    const rows = finishes.filter((f) => f.status === "unassigned" || f.status === "conflict");
    const by: Record<SortKey, (a: FinishOut, b: FinishOut) => number> = {
      time: (a, b) => a.recorded_at.localeCompare(b.recorded_at),
      bib: (a, b) => (a.bib ?? Infinity) - (b.bib ?? Infinity),
      status: (a, b) => a.status.localeCompare(b.status) || a.recorded_at.localeCompare(b.recorded_at),
    };
    return [...rows].sort(by[sort]);
  }, [finishes, sort]);

  return (
    <div>
      <h1>Ohne Startnummer / Konflikte</h1>
      <AuthNotice error={error} />
      <InfoBox id="unassigned">
        Hier landen Zieleinläufe ohne lesbare Startnummer sowie Konflikte (zwei Einläufe für
        dieselbe Nummer). Startnummer eintippen – der Name wird zur Kontrolle angezeigt – dann{" "}
        <strong>Zuordnen</strong>; der Einlauf wird automatisch dem richtigen Rennen zugeordnet. Bei
        einem Konflikt den falschen Eintrag <strong>Stornieren</strong>.
      </InfoBox>
      <p style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <EventSelect events={events} value={eventId} onChange={setEventId} />
        <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
          <span style={{ color: "var(--ink-dim)", fontSize: "0.9rem" }}>Sortieren</span>
          <SelectField
            className="w-36"
            value={sort}
            onValueChange={(v) => setSort(v as SortKey)}
            ariaLabel="Sortieren"
            options={SORT_OPTIONS}
          />
        </label>
      </p>
      <ul className="entry-list" style={{ marginTop: "1rem" }}>
        {open.map((f) => (
          <AssignRow key={f.id} finish={f} bibMap={bibMap} onChanged={reload} />
        ))}
      </ul>
      {open.length === 0 && <p>Nichts offen. 🎉</p>}
    </div>
  );
}
