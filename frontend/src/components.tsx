import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import type { EventInfo } from "./api";

export type ConfirmFn = (message: string, action: () => void) => void;

/** Confirmation modal for destructive actions. Returns the dialog element
 * (render it once) and a function to request confirmation. */
export function useConfirm(): [ReactNode, ConfirmFn] {
  const [pending, setPending] = useState<{ message: string; action: () => void } | null>(null);

  const dialog = pending ? (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <p>{pending.message}</p>
        <div className="modal-actions">
          <button onClick={() => setPending(null)} autoFocus>
            Abbrechen
          </button>
          <button
            className="danger"
            onClick={() => {
              pending.action();
              setPending(null);
            }}
          >
            Bestätigen
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [dialog, (message, action) => setPending({ message, action })];
}

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
