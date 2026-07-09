// Assign bibs to finish records logged without a readable number, and
// resolve conflicts (two finishes for the same bib — one must be voided or
// moved to the right bib).
import { useCallback, useEffect, useState } from "react";
import { api, formatClock, type FinishOut } from "../api";
import { AuthNotice } from "../components";
import { useAdminEvents } from "../hooks";

function AssignRow({ finish, onChanged }: { finish: FinishOut; onChanged: () => void }) {
  const [bib, setBib] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // confirm the runner's name before assigning
  const check = async () => {
    setPreview(null);
    if (!bib) return;
    try {
      const res = await api<{ name: string }>(
        `/api/races/${finish.race_id}/lookup?bib=${parseInt(bib, 10)}`
      );
      setPreview(res.name);
    } catch {
      setPreview("⚠︎ unbekannte Startnummer in diesem Rennen");
    }
  };

  const assign = async () => {
    try {
      await api(`/api/finishes/${finish.id}`, {
        method: "PATCH",
        body: JSON.stringify({ bib: parseInt(bib, 10) }),
      });
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const voidIt = async () => {
    if (!window.confirm("Diesen Zieleinlauf stornieren?")) return;
    await api(`/api/finishes/${finish.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "voided" }),
    });
    onChanged();
  };

  return (
    <li>
      <span className="bib">{finish.bib ?? "?"}</span>
      <span className={`badge ${finish.status}`}>{finish.status}</span>
      <span>
        {finish.elapsed_seconds != null
          ? formatClock(finish.elapsed_seconds)
          : new Date(finish.recorded_at).toLocaleTimeString()}
      </span>
      <span style={{ flex: 1 }}>{finish.participant_name ?? ""}</span>
      <input
        type="number"
        placeholder="Startnr."
        style={{ width: "6rem" }}
        value={bib}
        onChange={(e) => setBib(e.target.value)}
        onBlur={check}
      />
      {preview && <span>{preview}</span>}
      <button className="primary" onClick={assign} disabled={!bib}>
        Zuordnen
      </button>
      <button onClick={voidIt}>Stornieren</button>
      {error && <span className="error">{error}</span>}
    </li>
  );
}

export default function Unassigned() {
  const { events, error } = useAdminEvents();
  const [raceId, setRaceId] = useState<number | null>(null);
  const [finishes, setFinishes] = useState<FinishOut[]>([]);

  const races = events.flatMap((e) => e.races.map((r) => ({ ...r, eventName: e.name })));

  useEffect(() => {
    if (races.length > 0 && raceId === null) setRaceId(races[0].id);
  }, [races, raceId]);

  const reload = useCallback(() => {
    if (raceId === null) return;
    api<FinishOut[]>(`/api/races/${raceId}/finishes?limit=500`).then(setFinishes);
  }, [raceId]);

  useEffect(() => {
    reload();
    const t = window.setInterval(reload, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  const open = finishes.filter((f) => f.status === "unassigned" || f.status === "conflict");

  return (
    <div>
      <h1>Ohne Startnummer / Konflikte</h1>
      <AuthNotice error={error} />
      <select value={raceId ?? ""} onChange={(e) => setRaceId(Number(e.target.value))}>
        {races.map((r) => (
          <option key={r.id} value={r.id}>
            {r.eventName} — {r.name}
          </option>
        ))}
      </select>
      <ul className="entry-list" style={{ marginTop: "1rem" }}>
        {open.map((f) => (
          <AssignRow key={f.id} finish={f} onChanged={reload} />
        ))}
      </ul>
      {open.length === 0 && <p>Nichts offen. 🎉</p>}
    </div>
  );
}
