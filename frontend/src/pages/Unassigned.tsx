// TODO: assign bibs to finish records logged without a readable number.
// - GET /api/races/{id}/finishes, filter status === "unassigned" (and show
//   "conflict" records here too — they need a manual decision)
// - PATCH /api/finishes/{id} with {bib} to assign; use
//   GET /api/races/{id}/lookup?bib= to confirm the runner's name first
export default function Unassigned() {
  return (
    <div>
      <h1>Ohne Startnummer</h1>
      <p>TODO: Zieleinläufe ohne Startnummer nachträglich zuordnen.</p>
    </div>
  );
}
