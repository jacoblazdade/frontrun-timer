// Day-of registration ("Nachmeldung"): fast single-form entry with the next
// free bib pre-filled, inline duplicate-bib errors, and a save-&-next flow —
// there is a queue at the table, so minimal clicks.
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Participant } from "../api";
import { AuthNotice, EventSelect, InfoBox } from "../components";
import { SelectField } from "../components/ui/select-field";
import { useAdminEvents } from "../hooks";

const GENDER_OPTIONS = [
  { value: "w", label: "weiblich" },
  { value: "m", label: "männlich" },
  { value: "x", label: "divers" },
];

const EMPTY = {
  firstName: "",
  lastName: "",
  gender: "w",
  birthYear: "",
  club: "",
  pair: false,
  partnerFirstName: "",
  partnerLastName: "",
  partnerGender: "m",
  partnerBirthYear: "",
  partnerClub: "",
};

export default function Register() {
  const { events, error } = useAdminEvents();
  const [eventId, setEventId] = useState<number | null>(null);
  const [raceId, setRaceId] = useState<number | null>(null);
  const [bib, setBib] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  const event = events.find((e) => e.id === eventId) ?? null;

  useEffect(() => {
    if (events.length > 0) {
      setEventId((prev) => prev ?? events[0].id);
    }
  }, [events]);

  useEffect(() => {
    if (event && !event.races.some((r) => r.id === raceId)) {
      setRaceId(event.races[0]?.id ?? null);
    }
  }, [event, raceId]);

  const fetchNextBib = useCallback(async () => {
    if (eventId === null) return;
    const { next_bib } = await api<{ next_bib: number }>(`/api/events/${eventId}/next-bib`);
    setBib(String(next_bib));
  }, [eventId]);

  useEffect(() => {
    void fetchNextBib();
  }, [fetchNextBib]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (raceId === null || !bib) return;
    setSaveError(null);
    const bibNum = parseInt(bib, 10);
    const pairGroup = form.pair ? `pair-${bibNum}` : null;
    const base = {
      race_id: raceId,
      bib: bibNum,
      pair_group: pairGroup,
    };
    try {
      const p = await api<Participant>("/api/participants", {
        method: "POST",
        body: JSON.stringify({
          ...base,
          first_name: form.firstName,
          last_name: form.lastName,
          gender: form.gender,
          birth_year: form.birthYear ? parseInt(form.birthYear, 10) : null,
          club: form.club || null,
        }),
      });
      if (form.pair) {
        await api<Participant>("/api/participants", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            first_name: form.partnerFirstName,
            last_name: form.partnerLastName,
            gender: form.partnerGender,
            birth_year: form.partnerBirthYear ? parseInt(form.partnerBirthYear, 10) : null,
            club: form.partnerClub || null,
          }),
        });
      }
      setLastSaved(
        `#${p.bib} ${form.firstName} ${form.lastName}` +
          (form.pair ? ` & ${form.partnerFirstName} ${form.partnerLastName}` : "")
      );
      // save & next: clear, prefill the next bib, focus the first field
      setForm(EMPTY);
      await fetchNextBib();
      firstNameRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSaveError(`Startnummer ${bibNum} ist bereits vergeben.`);
      } else {
        setSaveError(String(err));
      }
    }
  };

  return (
    <div>
      <h1>Nachmeldung</h1>
      <AuthNotice error={error} />
      <InfoBox id="register">
        Schnellerfassung am Anmeldetisch. Die nächste freie Startnummer ist vorausgefüllt
        (überschreibbar). <strong>Speichern &amp; weiter</strong> legt die Person an und leert das
        Formular für die nächste in der Schlange. Für Paarläufe den Haken setzen – beide Partner
        teilen sich dieselbe Startnummer.
      </InfoBox>
      <form className="form-grid" onSubmit={submit}>
        <EventSelect events={events} value={eventId} onChange={setEventId} />
        <SelectField
          value={raceId != null ? String(raceId) : undefined}
          onValueChange={(v) => setRaceId(Number(v))}
          ariaLabel="Rennen"
          placeholder="Rennen wählen"
          options={(event?.races ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
        />
        <label>
          Startnummer{" "}
          <input
            type="number"
            min={1}
            value={bib}
            onChange={(e) => {
              setBib(e.target.value);
              setSaveError(null);
            }}
            style={{ width: "6rem" }}
            required
          />
        </label>
        <input
          ref={firstNameRef}
          placeholder="Vorname"
          value={form.firstName}
          onChange={set("firstName")}
          required
        />
        <input
          placeholder="Nachname"
          value={form.lastName}
          onChange={set("lastName")}
          required
        />
        <SelectField
          value={form.gender}
          onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}
          ariaLabel="Geschlecht"
          options={GENDER_OPTIONS}
        />
        <input
          type="number"
          placeholder="Jahrgang (optional)"
          value={form.birthYear}
          onChange={set("birthYear")}
        />
        <input placeholder="Verein (optional)" value={form.club} onChange={set("club")} />

        <label>
          <input
            type="checkbox"
            checked={form.pair}
            onChange={(e) => setForm((f) => ({ ...f, pair: e.target.checked }))}
          />{" "}
          Paarlauf (Partner:in teilt die Startnummer)
        </label>
        {form.pair && (
          <>
            <input
              placeholder="Partner:in Vorname"
              value={form.partnerFirstName}
              onChange={set("partnerFirstName")}
              required
            />
            <input
              placeholder="Partner:in Nachname"
              value={form.partnerLastName}
              onChange={set("partnerLastName")}
              required
            />
            <SelectField
              value={form.partnerGender}
              onValueChange={(v) => setForm((f) => ({ ...f, partnerGender: v }))}
              ariaLabel="Geschlecht Partner:in"
              options={GENDER_OPTIONS}
            />
            <input
              type="number"
              placeholder="Jahrgang Partner:in (optional)"
              value={form.partnerBirthYear}
              onChange={set("partnerBirthYear")}
            />
            <input
              placeholder="Verein Partner:in (optional)"
              value={form.partnerClub}
              onChange={set("partnerClub")}
            />
          </>
        )}

        <button className="primary" type="submit">
          Speichern &amp; weiter
        </button>
        {saveError && <p className="error">{saveError}</p>}
        {lastSaved && <p>Gespeichert: {lastSaved}</p>}
      </form>
    </div>
  );
}
