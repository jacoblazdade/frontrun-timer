// Race control: start races, correct start times (fixes all elapsed times
// retroactively — elapsed is always derived), set status, publish results.
import { useState } from "react";
import { api, toLocalInput, type EventInfo, type Race } from "../api";
import { AuthNotice } from "../components";
import { useAdminEvents } from "../hooks";

function RaceRow({ race, onChanged }: { race: Race; onChanged: () => void }) {
  const [startInput, setStartInput] = useState(
    race.started_at ? toLocalInput(race.started_at) : ""
  );
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!window.confirm(`${race.name} jetzt starten?`)) return;
    try {
      await api(`/api/races/${race.id}/start`, { method: "POST" });
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const patch = async (body: object) => {
    try {
      await api(`/api/races/${race.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setError(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <tr>
      <td>{race.name}</td>
      <td>
        <select value={race.status} onChange={(e) => patch({ status: e.target.value })}>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="finished">finished</option>
        </select>
      </td>
      <td>
        {race.started_at === null ? (
          <button className="primary" onClick={start}>
            Start
          </button>
        ) : (
          <span style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="datetime-local"
              step="1"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
            <button
              onClick={() => patch({ started_at: new Date(startInput).toISOString() })}
              disabled={!startInput}
            >
              Startzeit korrigieren
            </button>
          </span>
        )}
        {error && <div className="error">{error}</div>}
      </td>
    </tr>
  );
}

function EventCard({ event, onChanged }: { event: EventInfo; onChanged: () => void }) {
  const togglePublish = async () => {
    await api(`/api/events/${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_published: !event.is_published }),
    });
    onChanged();
  };

  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2>
        {event.name} <small>({event.date})</small>
      </h2>
      <p>
        <label>
          <input type="checkbox" checked={event.is_published} onChange={togglePublish} />{" "}
          Ergebnisse veröffentlicht
        </label>{" "}
        · <a href={`/api/events/${event.id}/export.xlsx`}>Export (XLSX)</a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Rennen</th>
            <th>Status</th>
            <th>Startzeit</th>
          </tr>
        </thead>
        <tbody>
          {event.races.map((r) => (
            <RaceRow key={r.id} race={r} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Races() {
  const { events, error, reload } = useAdminEvents();
  return (
    <div>
      <h1>Rennen</h1>
      <AuthNotice error={error} />
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} onChanged={reload} />
      ))}
    </div>
  );
}
