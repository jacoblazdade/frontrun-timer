// TODO: participants import + list + edit.
// - XLSX/CSV upload with column mapping UI → POST /api/events/{id}/import
//   (dry_run=true first, show the validation report, then commit)
// - list via GET /api/events/{id}/participants, inline edit via PATCH
export default function Participants() {
  return (
    <div>
      <h1>Teilnehmer</h1>
      <p>TODO: Import (XLSX/CSV mit Spalten-Zuordnung), Liste und Bearbeitung.</p>
    </div>
  );
}
