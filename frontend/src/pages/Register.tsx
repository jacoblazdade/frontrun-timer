// Day-of registration ("Nachmeldung"): fast single-form entry with the next
// free bib pre-filled, inline duplicate-bib errors, and a save-&-next flow —
// there is a queue at the table, so minimal clicks.
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Participant } from "../api";
import { AuthNotice, EventSelect } from "../components";
import { useAdminEvents } from "../hooks";

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
      birth_year: form.birthYear ? parseInt(form.birthYear, 10) : null,
      club: form.club || null,
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
      <form className="form-grid" onSubmit={submit}>
        <EventSelect events={events} value={eventId} onChange={setEventId} />
        <select value={raceId ?? ""} onChange={(e) => setRaceId(Number(e.target.value))}>
          {(event?.races ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
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
        <select value={form.gender} onChange={set("gender")}>
          <option value="w">weiblich</option>
          <option value="m">männlich</option>
          <option value="x">divers</option>
        </select>
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
            <select value={form.partnerGender} onChange={set("partnerGender")}>
              <option value="w">weiblich</option>
              <option value="m">männlich</option>
              <option value="x">divers</option>
            </select>
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
