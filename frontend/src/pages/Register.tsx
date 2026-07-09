// TODO: day-of registration ("Nachmeldung") — fast single-form entry:
// - next free bib pre-filled from GET /api/events/{id}/next-bib, editable
// - inline duplicate-bib check (409 from POST /api/participants)
// - fields: name, gender, race, birth year, club, optional pair partner
// - "save & next" flow: after POST, clear the form, refetch next-bib, focus
//   the first field — there is a queue at the table, minimize clicks
// - participants created here get source="day_of" (the API default)
export default function Register() {
  return (
    <div>
      <h1>Nachmeldung</h1>
      <p>TODO: Schnellerfassung mit vorbelegter nächster Startnummer.</p>
    </div>
  );
}
