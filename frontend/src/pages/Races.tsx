// Race control: start races (individually or all on one gun), correct start
// times (fixes all elapsed times retroactively — elapsed is always derived),
// reset an accidental start, clear a race's results, publish, and create
// next year's event.
import { FormEvent, useState } from "react";
import { api, toLocalInput, type EventInfo, type Race } from "../api";
import { AuthNotice, useConfirm, type ConfirmFn } from "../components";
import { useAdminEvents } from "../hooks";

function RaceRow({
  race,
  confirm,
  onChanged,
}: {
  race: Race;
  confirm: ConfirmFn;
  onChanged: () => void;
}) {
  const [startInput, setStartInput] = useState(
    race.started_at ? toLocalInput(race.started_at) : ""
  );
  const [error, setError] = useState<string | null>(null);

  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const patch = (body: object) =>
    call(() => api(`/api/races/${race.id}`, { method: "PATCH", body: JSON.stringify(body) }));

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
          <button
            className="primary"
            onClick={() =>
              confirm(`${race.name} jetzt starten?`, () =>
                call(() => api(`/api/races/${race.id}/start`, { method: "POST" }))
              )
            }
          >
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
            <button
              onClick={() =>
                confirm(
                  `${race.name} zurücksetzen? Die Startzeit wird gelöscht — vorhandene ` +
                    "Zieleinläufe bleiben erhalten, haben aber keine Laufzeit mehr, " +
                    "bis neu gestartet wird.",
                  () => patch({ started_at: null, status: "pending" })
                )
              }
            >
              Zurücksetzen
            </button>
          </span>
        )}
      </td>
      <td>
        <button
          className="danger"
          onClick={() =>
            confirm(
              `Wirklich ALLE Zieleinläufe von ${race.name} unwiderruflich löschen? ` +
                "Gedacht für Testeinträge oder einen Fehlstart.",
              () => call(() => api(`/api/races/${race.id}/finishes`, { method: "DELETE" }))
            )
          }
        >
          Ergebnisse löschen
        </button>
        {error && <div className="error">{error}</div>}
      </td>
    </tr>
  );
}

function EventCard({ event, onChanged }: { event: EventInfo; onChanged: () => void }) {
  const [dialog, confirm] = useConfirm();
  const anyUnstarted = event.races.some((r) => r.started_at === null);

  const togglePublish = async () => {
    await api(`/api/events/${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_published: !event.is_published }),
    });
    onChanged();
  };

  const startAll = () =>
    confirm(
      `Alle Rennen von ${event.name} JETZT gleichzeitig starten? ` +
        "Alle noch nicht gestarteten Rennen bekommen dieselbe Startzeit.",
      async () => {
        await api(`/api/events/${event.id}/start-races`, { method: "POST" });
        onChanged();
      }
    );

  return (
    <section style={{ marginBottom: "2rem" }}>
      {dialog}
      <h2>
        {event.name} <small>({event.date})</small>
      </h2>
      <p style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        {anyUnstarted && (
          <button className="primary" onClick={startAll}>
            🏁 Alle Rennen starten
          </button>
        )}
        <label>
          <input type="checkbox" checked={event.is_published} onChange={togglePublish} />{" "}
          Ergebnisse veröffentlicht
        </label>
        <a href={`/api/events/${event.id}/export.xlsx`}>Export (XLSX)</a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Rennen</th>
            <th>Status</th>
            <th>Startzeit</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {event.races.map((r) => (
            <RaceRow key={r.id} race={r} confirm={confirm} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NewEventForm({ onCreated }: { onCreated: () => void }) {
  const nextYear = new Date().getFullYear() + 1;
  const [name, setName] = useState(`Frontrun ${nextYear}`);
  const [date, setDate] = useState(`${nextYear}-09-01`);
  const [races, setRaces] = useState("5 km, 10 km");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/events", {
        method: "POST",
        body: JSON.stringify({
          name,
          date,
          races: races.split(",").map((r) => r.trim()).filter(Boolean),
        }),
      });
      setError(null);
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <details style={{ marginBottom: "1.5rem" }}>
      <summary>Neues Event anlegen (z.&nbsp;B. nächstes Jahr)</summary>
      <form className="form-grid" style={{ marginTop: "0.75rem" }} onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <label>
          Rennen (kommagetrennt){" "}
          <input value={races} onChange={(e) => setRaces(e.target.value)} />
        </label>
        <button className="primary" type="submit">
          Anlegen
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </details>
  );
}

export default function Races() {
  const { events, error, reload } = useAdminEvents();
  return (
    <div>
      <h1>Rennen</h1>
      <AuthNotice error={error} />
      <NewEventForm onCreated={reload} />
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} onChanged={reload} />
      ))}
    </div>
  );
}
