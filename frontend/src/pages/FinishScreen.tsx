// Finish-line screen — the critical page. Works offline: every tap goes to
// the IndexedDB outbox with a local timestamp and is synced when online
// (the server dedupes by client_id).
//
// Bibs are unique per EVENT, so the screen routes each entered bib to its
// runner's race automatically (5 km / 10 km) via a prefetched bib→race map —
// the timer never switches races. The race selector only sets the fallback
// for empty taps and unknown bibs. The map is fetched at load; if the device
// was offline from the start, everything falls back to the selected race.
//
// Input works two ways: the on-screen keypad (for phones) and the physical
// keyboard (digits, Enter, Backspace — for a laptop at the finish line).
// A bib left empty + Enter logs a finish without a readable number (assigned
// later under „Einläufe"). The "Eintrag nachtragen" panel inserts a
// missed finisher at a specific time.
//
// The entry list below the keypad shows the event's COMPLETE finish list (not
// just the last few) so entries can be found and corrected; it scrolls inside
// a fixed height so the clock and keypad stay put, and a filter box narrows it
// by start number or name.
import { CornerDownLeft, Delete, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  formatClock,
  type BibTarget,
  type EventInfo,
  type FinishOut,
  type Race,
} from "../api";
import { InfoBox } from "../components";
import { SelectField } from "../components/ui/select-field";
import {
  enqueueFinish,
  pendingEntries,
  startOutboxSync,
  unvoidPending,
  voidPending,
  type OutboxEntry,
} from "../outbox";

interface BibRoute {
  raceId: number;
  raceName: string;
  name: string;
}

/** Parse an elapsed time as seconds. Accepts "ss", "mm:ss" or "hh:mm:ss". */
function parseElapsed(input: string): number | null {
  const parts = input.trim().split(":").map((p) => p.trim());
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return null;
  }
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

// Insert a missed finisher at a chosen time. Goes through the same offline
// outbox as a live tap — the elapsed time is added to the race's start time
// client-side, so it slots into the ranking at the right position.
function ManualEntry({
  races,
  bibMap,
  fallbackRaceId,
  onInserted,
}: {
  races: Race[];
  bibMap: Map<number, BibRoute>;
  fallbackRaceId: number | null;
  onInserted: () => void;
}) {
  const [bib, setBib] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const bibNum = bib.trim() ? parseInt(bib, 10) : null;
  const targetRaceId = (bibNum !== null && bibMap.get(bibNum)?.raceId) || fallbackRaceId;
  const targetRace = races.find((r) => r.id === targetRaceId) ?? null;

  const submit = async () => {
    setError(null);
    setOk(false);
    const secs = parseElapsed(elapsed);
    if (secs === null) {
      setError("Zeit im Format mm:ss oder h:mm:ss angeben");
      return;
    }
    if (targetRace === null) {
      setError("Kein Rennen gewählt");
      return;
    }
    if (targetRace.started_at === null) {
      setError(`${targetRace.name} ist noch nicht gestartet`);
      return;
    }
    const recordedAt = new Date(
      new Date(targetRace.started_at).getTime() + secs * 1000
    ).toISOString();
    await enqueueFinish(targetRace.id, bibNum, recordedAt);
    setBib("");
    setElapsed("");
    setOk(true);
    onInserted();
  };

  return (
    <details style={{ marginTop: "0.25rem" }}>
      <summary>Eintrag nachtragen (Nr. + Zeit)</summary>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <input
          type="number"
          inputMode="numeric"
          placeholder="Startnr. (leer = ohne)"
          style={{ width: "9rem" }}
          value={bib}
          onChange={(e) => setBib(e.target.value)}
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="Zeit mm:ss"
          style={{ width: "7rem" }}
          value={elapsed}
          onChange={(e) => setElapsed(e.target.value)}
        />
        <button className="primary" onClick={submit}>
          Einfügen
        </button>
      </div>
      <small style={{ display: "block", marginTop: "0.4rem", color: "var(--ink-dim)" }}>
        {targetRace
          ? `Läuft in: ${targetRace.name} (Zeit = Laufzeit seit Start)`
          : "Rennen über die Startnummer oder das Rennen-Feld oben bestimmt"}
      </small>
      {error && <p className="error">{error}</p>}
      {ok && <p style={{ color: "var(--green)" }}>Eingefügt ✓</p>}
    </details>
  );
}

export default function FinishScreen() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [bibMap, setBibMap] = useState<Map<number, BibRoute>>(new Map());
  const [bib, setBib] = useState("");
  const [finishes, setFinishes] = useState<FinishOut[]>([]);
  const [pending, setPending] = useState<OutboxEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  // filter over the full entry list (Startnr. or Name) — the list shows the
  // whole event, so finding one entry to correct needs a way in
  const [listFilter, setListFilter] = useState("");

  const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);
  const races: Race[] = useMemo(() => event?.races ?? [], [event]);
  // No finishes may be logged unless a race is actually in progress.
  const runningRace = useMemo(() => races.find((r) => r.status === "running") ?? null, [races]);
  const anyRunning = runningRace !== null;
  // Empty and unknown taps have no bib to route on, so they go to the race
  // that is currently running (races share one gun). The race is only
  // provisional — assigning the bib later on /admin/unassigned moves the
  // finish to the bib's actual race — so no picker is needed here.
  const defaultRace = runningRace ?? races[0] ?? null;
  const defaultRaceId = defaultRace?.id ?? null;

  // load events (timer-accessible); default to the one with a running race
  useEffect(() => {
    api<EventInfo[]>("/api/timer/events")
      .then((evs) => {
        setEvents(evs);
        const running = evs.find((e) => e.races.some((r) => r.status === "running"));
        setEventId((prev) => prev ?? (running ?? evs[0])?.id ?? null);
      })
      .catch((e) => setError(`Nicht eingeloggt? ${e.message}`));
  }, []);

  // bib → race/name map for automatic routing (groups merged server-side).
  // Refetched periodically and on focus so day-of registrations (incl. new
  // Paarlauf groups) become known within seconds instead of routing as
  // "unbekannt" to the fallback race.
  const loadBibs = useCallback(() => {
    if (eventId === null) return;
    api<BibTarget[]>(`/api/events/${eventId}/bibs`)
      .then((targets) => {
        setBibMap(
          new Map(
            targets.map((t) => [
              t.bib,
              { raceId: t.race_id, raceName: t.race_name, name: t.name },
            ])
          )
        );
      })
      .catch(() => {
        /* offline — unknown bibs fall back to the selected race */
      });
  }, [eventId]);

  useEffect(() => {
    loadBibs();
    const t = window.setInterval(loadBibs, 15000);
    window.addEventListener("focus", loadBibs);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", loadBibs);
    };
  }, [loadBibs]);

  // live race clock — only ticks while a race is actually running
  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  // outbox background sync
  useEffect(() => startOutboxSync(), []);

  const refresh = useCallback(async () => {
    if (eventId === null) return;
    const raceIds = new Set(races.map((r) => r.id));
    setPending((await pendingEntries()).filter((e) => raceIds.has(e.raceId)));
    try {
      // the whole event, not just the last few: the timer works through the
      // list to correct entries, and an event is a few hundred rows at most
      setFinishes(await api<FinishOut[]>(`/api/events/${eventId}/finishes?limit=2000`));
    } catch {
      /* offline — the pending list still shows local taps */
    }
  }, [eventId, races]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const logFinish = async (bibValue: number | null) => {
    // route to the runner's race; empty and unknown bibs go to the running race
    const target =
      bibValue !== null ? bibMap.get(bibValue)?.raceId ?? defaultRaceId : defaultRaceId;
    if (target === null) return;
    await enqueueFinish(target, bibValue); // timestamped now, synced later
    void refresh();
  };

  const undo = async (finish: FinishOut) => {
    try {
      await api(`/api/finishes/${finish.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "voided" }),
      });
      void refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  // undo a deletion: restore a voided record (status recomputed server-side)
  const restore = async (finish: FinishOut) => {
    try {
      await api(`/api/finishes/${finish.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ok" }),
      });
      void refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const key = (k: string) => {
    if (k === "⏎") {
      // no race in progress → refuse the finish and tell the timer why
      if (!anyRunning) {
        setError("Kein Rennen läuft — Einträge sind gesperrt, bis ein Rennen gestartet ist.");
        return;
      }
      setError(null);
      // clear synchronously BEFORE the async log: finishers arrive in
      // bursts, and digits typed right after ⏎ must not be wiped later.
      // An empty bib logs an "unassigned" finish (assigned later).
      const value = bib ? parseInt(bib, 10) : null;
      setBib("");
      void logFinish(value);
    } else if (k === "⌫") {
      setBib((b) => b.slice(0, -1));
    } else {
      setBib((b) => (b + k).slice(0, 4));
    }
  };

  // physical keyboard (laptop at the finish line): digits type into the bib,
  // Enter logs, Backspace deletes. Ignored while a text field/select is
  // focused (e.g. the "Eintrag nachtragen" panel). A "latest ref" keeps the
  // once-registered listener calling the current closure without re-binding.
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key >= "0" && e.key <= "9") keyRef.current(e.key);
      else if (e.key === "Enter") keyRef.current("⏎");
      else if (e.key === "Backspace") keyRef.current("⌫");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clock: the running race, else the last one that was started (so the final
  // time stays on screen after the event).
  const clockRace =
    runningRace ?? [...races].reverse().find((r) => r.started_at !== null) ?? null;
  // A race has no end time of its own, so once nothing is running the clock
  // freezes at the last finish logged for that race instead of counting on.
  const frozenAt = useMemo(() => {
    if (runningRace !== null || clockRace === null) return null;
    const times = [
      ...finishes
        .filter((f) => f.race_id === clockRace.id && f.status !== "voided")
        .map((f) => new Date(f.recorded_at).getTime()),
      ...pending
        .filter((p) => p.raceId === clockRace.id && !p.voided)
        .map((p) => new Date(p.recordedAt).getTime()),
    ];
    return times.length > 0 ? Math.max(...times) : null;
  }, [runningRace, clockRace, finishes, pending]);
  const clockStart = clockRace?.started_at != null ? new Date(clockRace.started_at).getTime() : null;
  // stopped with nothing logged → no duration to show
  const clockAt = runningRace !== null ? now : frozenAt;
  const clock =
    clockStart !== null && clockAt !== null
      ? formatClock((clockAt - clockStart) / 1000)
      : "–:––:––";

  // live preview of who the typed bib belongs to
  const typedTarget = bib ? bibMap.get(parseInt(bib, 10)) ?? null : null;

  // list filter: matches the start number or any part of the name
  const needle = listFilter.trim().toLowerCase();
  const shownFinishes = useMemo(
    () =>
      needle === ""
        ? finishes
        : finishes.filter(
            (f) =>
              String(f.bib ?? "").startsWith(needle) ||
              (f.participant_name ?? "").toLowerCase().includes(needle)
          ),
    [finishes, needle]
  );
  const shownPending = useMemo(
    () =>
      needle === ""
        ? pending
        : pending.filter((p) => String(p.bib ?? "").startsWith(needle)),
    [pending, needle]
  );
  const openCount = useMemo(
    () => finishes.filter((f) => f.status === "unassigned" || f.status === "conflict").length,
    [finishes]
  );

  return (
    <div className="finish-screen">
      <InfoBox id="finish">
        Startnummer eintippen und <strong>⏎</strong> drücken (auf dem Laptop gehen auch die
        Zifferntasten, <strong>Enter</strong> und <strong>Rücktaste</strong>). Einlauf{" "}
        <strong>ohne lesbare Nummer</strong>: Feld leer lassen und ⏎ – später unter „Ohne Startnr."
        zuordnen. Der 5-/10-km-Lauf wird anhand der Startnummer automatisch erkannt; ein Einlauf ohne
        Nummer wird beim Zuordnen automatisch dem richtigen Rennen zugewiesen.
      </InfoBox>
      <SelectField
        value={eventId != null ? String(eventId) : undefined}
        onValueChange={(v) => setEventId(Number(v))}
        ariaLabel="Event"
        className="w-full"
        options={events.map((ev) => ({ value: String(ev.id), label: ev.name }))}
      />

      {!anyRunning && (
        <p className="finish-blocked" role="status">
          Kein Rennen läuft. Einträge sind gesperrt, bis ein Rennen unter „Rennen" gestartet wird.
        </p>
      )}

      <div className={`race-clock${anyRunning ? "" : " stopped"}`}>{clock}</div>
      <div className="bib-display">
        {bib || " "}
        <div className="bib-preview">
          {typedTarget
            ? `${typedTarget.name} · ${typedTarget.raceName}`
            : bib
              ? "unbekannte Startnummer"
              : "leer = ohne Startnummer"}
        </div>
      </div>

      <div className={`keypad${anyRunning ? "" : " disabled"}`}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "⏎"].map((k) => (
          <button
            key={k}
            className={k === "⏎" ? "enter" : ""}
            aria-label={k === "⏎" ? "Zeit erfassen" : k === "⌫" ? "Löschen" : undefined}
            disabled={!anyRunning}
            onClick={() => key(k)}
          >
            {k === "⏎" ? <CornerDownLeft size={30} /> : k === "⌫" ? <Delete size={28} /> : k}
          </button>
        ))}
      </div>

      <ManualEntry
        races={races}
        bibMap={bibMap}
        fallbackRaceId={defaultRaceId}
        onInserted={refresh}
      />

      {error && <p className="error">{error}</p>}
      {pending.length > 0 && (
        <p>
          <span className="badge pending-sync">{pending.length} offline — wird synchronisiert</span>
        </p>
      )}

      <div className="list-toolbar">
        <input
          type="search"
          placeholder="Liste filtern (Nr. oder Name)"
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
          style={{ flex: 1, minWidth: "9rem" }}
        />
        <span className="list-count">
          {needle ? `${shownFinishes.length}/${finishes.length}` : `${finishes.length} Einträge`}
          {openCount > 0 && <span className="badge unassigned">{openCount} offen</span>}
        </span>
      </div>

      <ul className="entry-list">
        {shownPending.map((p) => (
          <li key={p.clientId} className={p.voided ? "voided" : ""}>
            <span className="bib">{p.bib ?? "?"}</span>
            <span className="badge pending-sync">offline</span>
            <span style={{ flex: 1 }}>{new Date(p.recordedAt).toLocaleTimeString()}</span>
            {p.voided ? (
              <button
                className="icon-button"
                aria-label="Wiederherstellen"
                onClick={() => unvoidPending(p.clientId).then(refresh)}
              >
                <RotateCcw size={18} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label="Rückgängig"
                onClick={() => voidPending(p.clientId).then(refresh)}
              >
                <Undo2 size={18} />
              </button>
            )}
          </li>
        ))}
        {shownFinishes.map((f) => (
          <li
            key={f.id}
            className={
              f.status === "voided"
                ? "voided"
                : f.status === "unassigned" || f.status === "conflict"
                  ? "open"
                  : ""
            }
          >
            <span className="bib">{f.bib ?? "?"}</span>
            {f.race_name && <span className="badge">{f.race_name}</span>}
            {f.status !== "ok" && <span className={`badge ${f.status}`}>{f.status}</span>}
            {f.bib !== null && f.participant_name === null && (
              <span className="badge conflict">unbekannt</span>
            )}
            <span>{f.elapsed_seconds != null ? formatClock(f.elapsed_seconds) : ""}</span>
            <span style={{ flex: 1 }}>{f.participant_name ?? ""}</span>
            {f.status === "voided" ? (
              <button
                className="icon-button"
                aria-label="Wiederherstellen"
                onClick={() => restore(f)}
              >
                <RotateCcw size={18} />
              </button>
            ) : (
              <button className="icon-button" aria-label="Rückgängig" onClick={() => undo(f)}>
                <Undo2 size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {shownFinishes.length === 0 && shownPending.length === 0 && (
        <p style={{ color: "var(--ink-dim)" }}>
          {needle ? "Kein Treffer." : "Noch keine Einträge."}
        </p>
      )}
    </div>
  );
}
