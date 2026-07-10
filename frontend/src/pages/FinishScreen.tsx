// Finish-line screen — the critical page. Works offline: every tap goes to
// the IndexedDB outbox with a local timestamp and is synced when online
// (the server dedupes by client_id).
//
// Bibs are unique per EVENT, so the screen routes each entered bib to its
// runner's race automatically (5 km / 10 km) via a prefetched bib→race map —
// the timer never switches races. The race selector only sets the fallback
// for "?" taps and unknown bibs. The map is fetched at load; if the device
// was offline from the start, everything falls back to the selected race.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  formatClock,
  type BibTarget,
  type EventInfo,
  type FinishOut,
  type Race,
} from "../api";
import {
  enqueueFinish,
  pendingEntries,
  startOutboxSync,
  voidPending,
  type OutboxEntry,
} from "../outbox";

interface BibRoute {
  raceId: number;
  raceName: string;
  name: string;
}

export default function FinishScreen() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [fallbackRaceId, setFallbackRaceId] = useState<number | null>(null);
  const [bibMap, setBibMap] = useState<Map<number, BibRoute>>(new Map());
  const [bib, setBib] = useState("");
  const [finishes, setFinishes] = useState<FinishOut[]>([]);
  const [pending, setPending] = useState<OutboxEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);
  const races: Race[] = useMemo(() => event?.races ?? [], [event]);

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

  useEffect(() => {
    if (event && !event.races.some((r) => r.id === fallbackRaceId)) {
      const running = event.races.find((r) => r.status === "running");
      setFallbackRaceId((running ?? event.races[0])?.id ?? null);
    }
  }, [event, fallbackRaceId]);

  // bib → race/name map for automatic routing (pairs merged server-side)
  useEffect(() => {
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

  // live race clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  // outbox background sync
  useEffect(() => startOutboxSync(), []);

  const refresh = useCallback(async () => {
    if (eventId === null) return;
    const raceIds = new Set(races.map((r) => r.id));
    setPending((await pendingEntries()).filter((e) => raceIds.has(e.raceId)));
    try {
      setFinishes(await api<FinishOut[]>(`/api/events/${eventId}/finishes?limit=10`));
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
    // route to the runner's race; "?" and unknown bibs go to the fallback
    const target = bibValue !== null ? bibMap.get(bibValue)?.raceId ?? fallbackRaceId : fallbackRaceId;
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

  const key = (k: string) => {
    if (k === "⏎") {
      // clear synchronously BEFORE the async log: finishers arrive in
      // bursts, and digits typed right after ⏎ must not be wiped later
      const value = bib ? parseInt(bib, 10) : null;
      setBib("");
      void logFinish(value);
    } else if (k === "?") {
      void logFinish(null);
    } else if (k === "⌫") {
      setBib((b) => b.slice(0, -1));
    } else {
      setBib((b) => (b + k).slice(0, 4));
    }
  };

  const clockRace =
    races.find((r) => r.id === fallbackRaceId) ?? races.find((r) => r.started_at !== null) ?? null;
  const clock =
    clockRace?.started_at != null
      ? formatClock((now - new Date(clockRace.started_at).getTime()) / 1000)
      : "–:––:––";

  // live preview of who the typed bib belongs to
  const typedTarget = bib ? bibMap.get(parseInt(bib, 10)) ?? null : null;

  return (
    <div className="finish-screen">
      <span style={{ display: "flex", gap: "0.5rem" }}>
        <select
          value={eventId ?? ""}
          onChange={(e) => setEventId(Number(e.target.value))}
          style={{ flex: 1 }}
        >
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
        <select
          title="Rennen für ? und unbekannte Startnummern"
          value={fallbackRaceId ?? ""}
          onChange={(e) => setFallbackRaceId(Number(e.target.value))}
        >
          {races.map((r) => (
            <option key={r.id} value={r.id}>
              ?→{r.name}
            </option>
          ))}
        </select>
      </span>

      <div className="race-clock">{clock}</div>
      <div className="bib-display">
        {bib || " "}
        <div className="bib-preview">
          {typedTarget
            ? `${typedTarget.name} · ${typedTarget.raceName}`
            : bib
              ? "unbekannte Startnummer"
              : " "}
        </div>
      </div>

      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "?", "0", "⏎"].map((k) => (
          <button
            key={k}
            className={k === "⏎" ? "enter" : k === "?" ? "unknown" : ""}
            onClick={() => key(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <button onClick={() => key("⌫")}>⌫ löschen</button>

      {error && <p className="error">{error}</p>}
      {pending.length > 0 && (
        <p>
          <span className="badge pending-sync">{pending.length} offline — wird synchronisiert</span>
        </p>
      )}

      <ul className="entry-list">
        {pending.map((p) => (
          <li key={p.clientId} className={p.voided ? "voided" : ""}>
            <span className="bib">{p.bib ?? "?"}</span>
            <span className="badge pending-sync">offline</span>
            <span style={{ flex: 1 }}>{new Date(p.recordedAt).toLocaleTimeString()}</span>
            {!p.voided && (
              <button onClick={() => voidPending(p.clientId).then(refresh)}>↩︎</button>
            )}
          </li>
        ))}
        {finishes.map((f) => (
          <li key={f.id} className={f.status === "voided" ? "voided" : ""}>
            <span className="bib">{f.bib ?? "?"}</span>
            {f.race_name && <span className="badge">{f.race_name}</span>}
            {f.status !== "ok" && <span className={`badge ${f.status}`}>{f.status}</span>}
            {f.bib !== null && f.participant_name === null && (
              <span className="badge conflict">unbekannt</span>
            )}
            <span>{f.elapsed_seconds != null ? formatClock(f.elapsed_seconds) : ""}</span>
            <span style={{ flex: 1 }}>{f.participant_name ?? ""}</span>
            {f.status !== "voided" && <button onClick={() => undo(f)}>↩︎</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
