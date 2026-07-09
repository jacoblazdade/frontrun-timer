// Public results: event selector (past years), category tabs, auto-poll.
// TODO: use `since=` incremental polling instead of refetching everything.
import { useEffect, useState } from "react";
import { api, type EventInfo, type ResultsOut } from "../api";

const POLL_MS = 7000;

export default function PublicResults() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [data, setData] = useState<ResultsOut | null>(null);

  useEffect(() => {
    api<EventInfo[]>("/api/events").then((evs) => {
      setEvents(evs);
      setEventId((prev) => prev ?? evs[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (eventId === null) return;
    const load = () => api<ResultsOut>(`/api/events/${eventId}/results`).then(setData);
    load();
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [eventId]);

  const categories = data?.categories ?? [];
  const active = category && categories.includes(category) ? category : categories[0] ?? null;
  const rows = (data?.results ?? []).filter((r) => r.category === active);

  return (
    <div>
      <h1>Ergebnisse</h1>
      <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>

      <div className="tabs">
        {categories.map((c) => (
          <button key={c} className={c === active ? "active" : ""} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Platz</th>
            <th>Startnr.</th>
            <th>Name</th>
            <th>Jahrgang</th>
            <th>Verein</th>
            <th>Zeit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.category}-${r.bib}`}>
              <td>{r.rank}</td>
              <td>{r.bib}</td>
              <td>{r.name}</td>
              <td>{r.birth_year ?? ""}</td>
              <td>{r.club ?? ""}</td>
              <td>{r.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>Noch keine Ergebnisse.</p>}
    </div>
  );
}
