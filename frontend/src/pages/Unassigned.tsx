// The event's COMPLETE finish list, with the entries that need a decision
// („offen" = ohne Startnummer / Konflikt) highlighted in place.
//
// A conflict can only be judged against the whole list — which number was
// logged twice, who is missing, which entry sits between which finishers — so
// this page shows every record and lets any of them be corrected: assign or
// change a start number, void a wrong entry, restore a voided one. „Nur
// offene" is a filter, not the only view.
//
// Scope is the whole EVENT, not a single race: the finish line needs no race
// picker, so an open finish isn't tied to a race yet. Assigning a bib routes
// the finish to that bib's race server-side (bibs are unique per event).
import { Pencil, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatClock, type BibTarget, type FinishOut } from "../api";
import { AuthNotice, EventSelect, InfoBox, useConfirm } from "../components";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";

type SortKey = "time" | "bib" | "status";

const SORT_OPTIONS = [
  { value: "time", label: "Zeit" },
  { value: "bib", label: "Startnr." },
  { value: "status", label: "Status" },
];

const STATUS_LABEL: Record<FinishOut["status"], string> = {
  ok: "ok",
  unassigned: "ohne Nr.",
  conflict: "Konflikt",
  voided: "storniert",
};

function isOpen(f: FinishOut): boolean {
  return f.status === "unassigned" || f.status === "conflict";
}

function Row({
  finish,
  position,
  duplicate,
  bibMap,
  onChanged,
  confirm,
}: {
  finish: FinishOut;
  /** finish position within its race (voided entries excluded) */
  position: number | null;
  /** an ok entry whose number is claimed by a conflicting entry as well */
  duplicate: boolean;
  bibMap: Map<number, BibTarget>;
  onChanged: () => void;
  confirm: (message: string, action: () => void) => void;
}) {
  const open = isOpen(finish);
  // open entries need a decision now, so their input is out; a settled entry
  // is only edited on purpose (pencil) to keep the list readable
  const [editing, setEditing] = useState(false);
  const [bib, setBib] = useState(finish.bib != null ? String(finish.bib) : "");
  const [error, setError] = useState<string | null>(null);
  const showInput = open || editing;

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
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const patchStatus = async (status: "voided" | "ok") => {
    try {
      await api(`/api/finishes/${finish.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setError(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const voidIt = () =>
    confirm(
      `Zieleinlauf ${finish.bib != null ? `Nr. ${finish.bib}` : "ohne Startnummer"} ` +
        `(${finish.race_name ?? ""}) stornieren?`,
      () => void patchStatus("voided")
    );

  return (
    <li className={finish.status === "voided" ? "voided" : open ? "open" : ""}>
      <span className="entry-pos" title={`Einlauf in ${finish.race_name ?? "Rennen"}`}>
        {position != null ? `#${position}` : "–"}
      </span>
      <span className="bib">{finish.bib ?? "?"}</span>
      {finish.race_name && <span className="badge">{finish.race_name}</span>}
      {finish.status !== "ok" && (
        <span className={`badge ${finish.status}`}>{STATUS_LABEL[finish.status]}</span>
      )}
      {duplicate && <span className="badge conflict">doppelt vergeben</span>}
      <span>
        {finish.elapsed_seconds != null
          ? formatClock(finish.elapsed_seconds)
          : new Date(finish.recorded_at).toLocaleTimeString()}
      </span>
      <span style={{ flex: 1 }}>{finish.participant_name ?? ""}</span>

      {showInput && (
        <>
          <input
            type="number"
            placeholder="Startnr."
            style={{ width: "6rem" }}
            value={bib}
            onChange={(e) => setBib(e.target.value)}
          />
          {preview && <span>{preview}</span>}
          <button className="primary" onClick={assign} disabled={!bib}>
            {finish.bib != null ? "Ändern" : "Zuordnen"}
          </button>
        </>
      )}
      {!showInput && finish.status !== "voided" && (
        <button
          className="icon-button"
          aria-label="Startnummer ändern"
          title="Startnummer ändern"
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} />
        </button>
      )}
      {finish.status === "voided" ? (
        <button
          className="icon-button"
          aria-label="Wiederherstellen"
          title="Wiederherstellen"
          onClick={() => void patchStatus("ok")}
        >
          <RotateCcw size={16} />
        </button>
      ) : (
        <button
          className="icon-button"
          aria-label="Stornieren"
          title="Stornieren"
          onClick={voidIt}
        >
          <X size={16} />
        </button>
      )}
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
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [dialog, confirm] = useConfirm();

  useEffect(() => {
    if (events.length > 0 && eventId === null) setEventId(events[0].id);
  }, [events, eventId]);

  const reload = useCallback(() => {
    if (eventId === null) return;
    api<FinishOut[]>(`/api/events/${eventId}/finishes?limit=2000`).then(setFinishes);
    api<BibTarget[]>(`/api/events/${eventId}/bibs`)
      .then((targets) => setBibMap(new Map(targets.map((t) => [t.bib, t]))))
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  const openCount = useMemo(() => finishes.filter(isOpen).length, [finishes]);

  // finish position per race, counted in time order over the entries that
  // still stand — the anchor for judging where an open entry belongs
  const positions = useMemo(() => {
    const byRace = new Map<number, FinishOut[]>();
    for (const f of finishes) {
      if (f.status === "voided") continue;
      const list = byRace.get(f.race_id) ?? byRace.set(f.race_id, []).get(f.race_id)!;
      list.push(f);
    }
    const pos = new Map<number, number>();
    for (const list of byRace.values()) {
      list
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
        .forEach((f, i) => pos.set(f.id, i + 1));
    }
    return pos;
  }, [finishes]);

  // numbers claimed by a conflicting entry: mark the ok entry too, so both
  // sides of a conflict are visible in the list
  const contestedBibs = useMemo(
    () =>
      new Set(
        finishes.filter((f) => f.status === "conflict" && f.bib != null).map((f) => f.bib as number)
      ),
    [finishes]
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matched = finishes.filter((f) => {
      if (onlyOpen && !isOpen(f)) return false;
      if (!needle) return true;
      return (
        String(f.bib ?? "").startsWith(needle) ||
        (f.participant_name ?? "").toLowerCase().includes(needle)
      );
    });
    const by: Record<SortKey, (a: FinishOut, b: FinishOut) => number> = {
      time: (a, b) => a.recorded_at.localeCompare(b.recorded_at),
      bib: (a, b) => (a.bib ?? Infinity) - (b.bib ?? Infinity),
      status: (a, b) =>
        a.status.localeCompare(b.status) || a.recorded_at.localeCompare(b.recorded_at),
    };
    return [...matched].sort(by[sort]);
  }, [finishes, onlyOpen, filter, sort]);

  return (
    <div>
      <h1>Zieleinläufe</h1>
      {dialog}
      <AuthNotice error={error} />
      <InfoBox id="unassigned">
        Die vollständige Einlaufliste des Events. <strong>Orange markiert</strong> sind Einträge,
        die eine Entscheidung brauchen: ohne lesbare Startnummer oder Konflikt (zwei Einläufe für
        dieselbe Nummer, beide Seiten sind markiert). Startnummer eintippen – der Name wird zur
        Kontrolle angezeigt – dann <strong>Zuordnen</strong>; der Einlauf wird automatisch dem
        richtigen Rennen zugeordnet. Falsche Einträge <strong>stornieren</strong> (✕),
        versehentlich stornierte wiederherstellen (↺). Bei bereits zugeordneten Einträgen die
        Nummer über den Stift korrigieren. <strong>#n</strong> ist die Einlaufposition im
        jeweiligen Rennen.
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
        <input
          type="search"
          placeholder="Filtern (Nr. oder Name)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "14rem" }}
        />
        <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          Nur offene ({openCount})
        </label>
      </p>
      <p style={{ color: "var(--ink-dim)" }}>
        {rows.length} von {finishes.length} Einläufen
        {openCount > 0 ? ` · ${openCount} offen` : " · nichts offen"}
      </p>
      <ul className="entry-list" style={{ marginTop: "1rem" }}>
        {rows.map((f) => (
          <Row
            key={f.id}
            finish={f}
            position={positions.get(f.id) ?? null}
            duplicate={f.status === "ok" && f.bib != null && contestedBibs.has(f.bib)}
            bibMap={bibMap}
            onChanged={reload}
            confirm={confirm}
          />
        ))}
      </ul>
      {rows.length === 0 && <p>Keine Einträge für diese Auswahl.</p>}
    </div>
  );
}
