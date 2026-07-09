import { Link } from "react-router-dom";
import type { EventInfo } from "./api";

export function AuthNotice({ error }: { error: string | null }) {
  if (error === null) return null;
  if (error === "auth") {
    return (
      <p className="error">
        Nicht angemeldet — <Link to="/login">zum Login</Link>
      </p>
    );
  }
  return <p className="error">{error}</p>;
}

export function EventSelect({
  events,
  value,
  onChange,
}: {
  events: EventInfo[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
      {events.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.name}
        </option>
      ))}
    </select>
  );
}
