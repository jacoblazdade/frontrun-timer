// Race control: start races (individually or all on one gun), correct start
// times (fixes all elapsed times retroactively — elapsed is always derived),
// reset an accidental start, clear a race's results, publish, and create
// next year's event.
import { AlertTriangle, Check, Eraser, Flag, Play, RotateCcw, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, RACE_STATUS_LABEL, toLocalInput, type EventInfo, type Race } from "../api";
import { AuthNotice, InfoBox, useConfirm, type ConfirmFn } from "../components";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";

const STATUS_OPTIONS = (["pending", "running", "finished"] as const).map((s) => ({
  value: s,
  label: RACE_STATUS_LABEL[s],
}));

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

  // keep the field in sync when the stored start time changes elsewhere
  // (e.g. "Alle Rennen starten"), so it shows immediately without a reload
  useEffect(() => {
    setStartInput(race.started_at ? toLocalInput(race.started_at) : "");
  }, [race.started_at]);

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

  const clearResults = () =>
    confirm(
      `Wirklich ALLE ${race.finish_count} Zieleinläufe von ${race.name} unwiderruflich ` +
        "löschen? Gedacht für Testeinträge oder einen Fehlstart.",
      () => call(() => api(`/api/races/${race.id}/finishes`, { method: "DELETE" }))
    );

  const deleteRace = () =>
    confirm(
      `Rennen „${race.name}" löschen? Das Rennen ist leer (keine Teilnehmer, keine ` +
        "Zieleinläufe) und wird endgültig entfernt.",
      () => call(() => api(`/api/races/${race.id}`, { method: "DELETE" }))
    );

  const reset = () =>
    confirm(
      `${race.name} zurücksetzen? Die Startzeit wird gelöscht — vorhandene ` +
        "Zieleinläufe bleiben erhalten, haben aber keine Laufzeit mehr, bis neu gestartet wird.",
      () => patch({ started_at: null, status: "pending" })
    );

  return (
    <tr>
      <td>{race.name}</td>
      <td>
        <SelectField
          className="w-44"
          value={race.status}
          onValueChange={(v) => patch({ status: v })}
          ariaLabel="Status"
          options={STATUS_OPTIONS}
        />
      </td>
      <td>
        {race.started_at === null ? (
          <button
            className="primary icon-button"
            aria-label="Rennen starten"
            title="Rennen jetzt starten"
            onClick={() =>
              confirm(`${race.name} jetzt starten?`, () =>
                call(() => api(`/api/races/${race.id}/start`, { method: "POST" }))
              )
            }
          >
            <Play size={16} />
          </button>
        ) : (
          <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="datetime-local"
              step="1"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="Startzeit korrigieren"
              title="Startzeit korrigieren"
              onClick={() => patch({ started_at: new Date(startInput).toISOString() })}
              disabled={!startInput}
            >
              <Check size={16} />
            </button>
          </span>
        )}
      </td>
      <td>
        <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
          {race.started_at !== null && (
            <button
              className="icon-button"
              aria-label="Zurücksetzen"
              title="Zurücksetzen (Startzeit löschen)"
              onClick={reset}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            className="danger icon-button"
            disabled={race.finish_count === 0}
            aria-label="Ergebnisse löschen"
            title={
              race.finish_count === 0
                ? "Keine Zieleinläufe vorhanden"
                : `${race.finish_count} Zieleinläufe löschen`
            }
            onClick={clearResults}
          >
            <Eraser size={16} />
          </button>
          <button
            className="danger icon-button"
            disabled={race.participant_count > 0 || race.finish_count > 0}
            aria-label="Rennen löschen"
            title={
              race.participant_count > 0 || race.finish_count > 0
                ? "Erst Teilnehmer und Ergebnisse dieses Rennens entfernen"
                : "Dieses Rennen löschen"
            }
            onClick={deleteRace}
          >
            <Trash2 size={16} />
          </button>
          {error && (
            <span className="error" title={error} aria-label={error} style={{ display: "inline-flex" }}>
              <AlertTriangle size={16} />
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}

function EventCard({ event, onChanged }: { event: EventInfo; onChanged: () => void }) {
  const [dialog, confirm] = useConfirm();
  const anyUnstarted = event.races.some((r) => r.started_at === null);
  // an event can be removed once nothing precious hangs off its races
  const hasData = event.races.some((r) => r.participant_count > 0 || r.finish_count > 0);

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

  const deleteEvent = () =>
    confirm(
      `Event „${event.name}" (${event.date}) endgültig löschen? Das Event und alle seine ` +
        "Rennen werden entfernt.",
      async () => {
        await api(`/api/events/${event.id}`, { method: "DELETE" });
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
          <button className="primary icon-button" onClick={startAll}>
            <Flag size={16} /> Alle Rennen starten
          </button>
        )}
        <label>
          <input type="checkbox" checked={event.is_published} onChange={togglePublish} />{" "}
          Ergebnisse veröffentlicht
        </label>
        <a href={`/api/events/${event.id}/export.xlsx`}>Export (XLSX)</a>
        <button
          className="danger icon-button"
          disabled={hasData}
          title={
            hasData
              ? "Erst Teilnehmer und Ergebnisse aller Rennen entfernen"
              : "Dieses Event und seine Rennen löschen"
          }
          style={{ marginLeft: "auto" }}
          onClick={deleteEvent}
        >
          <Trash2 size={16} /> Event löschen
        </button>
      </p>
      {event.races.length === 0 ? (
        <p className="empty-state" style={{ padding: "1.5rem 1rem" }}>
          <span>Dieses Event hat keine Rennen mehr.</span>
        </p>
      ) : (
      <div className="table-scroll">
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
      </div>
      )}
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
      <InfoBox id="races">
        Steuerzentrale für den Wettkampf. <strong>Alle Rennen starten</strong> gibt allen Läufen
        denselben Startschuss (gemeinsame Startzeit). Eine falsche Startzeit lässt sich jederzeit
        korrigieren – alle Laufzeiten werden automatisch neu berechnet. Ergebnisse erscheinen erst
        öffentlich, wenn <strong>Ergebnisse veröffentlicht</strong> gesetzt ist.
      </InfoBox>
      <NewEventForm onCreated={reload} />
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} onChanged={reload} />
      ))}
    </div>
  );
}
