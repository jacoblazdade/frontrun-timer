// TODO: race control — start/stop races, fix start time, publish results.
// - POST /api/races/{id}/start
// - PATCH /api/races/{id} with {started_at} (corrects all elapsed times
//   retroactively — elapsed is always derived) or {status}
// - PATCH /api/events/{id} with {is_published: true} to publish results
// - link to GET /api/events/{id}/export.xlsx
export default function Races() {
  return (
    <div>
      <h1>Rennen</h1>
      <p>TODO: Start/Stopp, Startzeit korrigieren, Ergebnisse veröffentlichen.</p>
    </div>
  );
}
