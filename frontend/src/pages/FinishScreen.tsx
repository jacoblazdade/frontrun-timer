// Finish-line screen — the critical page. Works offline: every tap goes to
// the IndexedDB outbox with a local timestamp and is synced when online
// (the server dedupes by client_id).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatClock, type EventInfo, type FinishOut, type Race } from "../api";
import {
  enqueueFinish,
  pendingEntries,
  startOutboxSync,
  voidPending,
  type OutboxEntry,
} from "../outbox";

export default function FinishScreen() {
  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState<number | null>(null);
  const [bib, setBib] = useState("");
  const [finishes, setFinishes] = useState<FinishOut[]>([]);
  const [pending, setPending] = useState<OutboxEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const race = useMemo(() => races.find((r) => r.id === raceId) ?? null, [races, raceId]);

  // load races (admin event list includes unpublished events)
  useEffect(() => {
    api<EventInfo[]>("/api/admin/events")
      .then((events) => {
        const all = events.flatMap((e) => e.races);
        setRaces(all);
        const running = all.find((r) => r.status === "running");
        setRaceId((prev) => prev ?? running?.id ?? all[0]?.id ?? null);
      })
      .catch((e) => setError(`Nicht eingeloggt? ${e.message}`));
  }, []);

  // live race clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  // outbox background sync
  useEffect(() => startOutboxSync(), []);

  const refresh = useCallback(async () => {
    if (raceId === null) return;
    setPending(await pendingEntries(raceId));
    try {
      setFinishes(await api<FinishOut[]>(`/api/races/${raceId}/finishes?limit=10`));
    } catch {
      /* offline — the pending list still shows local taps */
    }
  }, [raceId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const logFinish = async (bibValue: number | null) => {
    if (raceId === null) return;
    await enqueueFinish(raceId, bibValue); // timestamped now, synced later
    setBib("");
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
    if (k === "⏎") void logFinish(bib ? parseInt(bib, 10) : null);
    else if (k === "?") void logFinish(null);
    else if (k === "⌫") setBib((b) => b.slice(0, -1));
    else setBib((b) => (b + k).slice(0, 4));
  };

  const clock =
    race?.started_at != null
      ? formatClock((now - new Date(race.started_at).getTime()) / 1000)
      : "–:––:––";

  return (
    <div className="finish-screen">
      <select value={raceId ?? ""} onChange={(e) => setRaceId(Number(e.target.value))}>
        {races.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.status})
          </option>
        ))}
      </select>

      <div className="race-clock">{clock}</div>
      <div className="bib-display">{bib || " "}</div>

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
            {f.status !== "ok" && <span className={`badge ${f.status}`}>{f.status}</span>}
            <span>{f.elapsed_seconds != null ? formatClock(f.elapsed_seconds) : ""}</span>
            <span style={{ flex: 1 }}>{f.participant_name ?? ""}</span>
            {f.status !== "voided" && <button onClick={() => undo(f)}>↩︎</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
