import { Info } from "lucide-react";
import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { EventInfo } from "./api";
import { SelectField } from "./components/ui/select-field";

/** Full-page modal scrim. Portaled to <body> so `position: fixed` is relative
 * to the viewport and it stacks above everything — rendered inline it would be
 * trapped inside any ancestor with a transform/filter (a containing block). */
export function ModalOverlay({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClick}>
      {children}
    </div>,
    document.body
  );
}

/** Dismissible help banner explaining how to use a page. */
export function InfoBox({ id, children }: { id: string; children: ReactNode }) {
  const storageKey = `frontrun.info.${id}`;
  const [hidden, setHidden] = useState(() => localStorage.getItem(storageKey) === "1");
  if (hidden) return null;
  return (
    <div className="info-box">
      <Info size={18} className="info-box-icon" />
      <div className="info-box-body">{children}</div>
      <button
        className="info-box-close"
        aria-label="Hinweis ausblenden"
        onClick={() => {
          localStorage.setItem(storageKey, "1");
          setHidden(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export type ConfirmFn = (message: string, action: () => void) => void;

/** Confirmation modal for destructive actions. Returns the dialog element
 * (render it once) and a function to request confirmation. */
export function useConfirm(): [ReactNode, ConfirmFn] {
  const [pending, setPending] = useState<{ message: string; action: () => void } | null>(null);

  const dialog = pending ? (
    <ModalOverlay>
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
    </ModalOverlay>
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
  className,
}: {
  events: EventInfo[];
  value: number | null;
  onChange: (id: number) => void;
  className?: string;
}) {
  return (
    <SelectField
      value={value != null ? String(value) : undefined}
      onValueChange={(v) => onChange(Number(v))}
      ariaLabel="Event"
      placeholder="Event wählen"
      // sized to typical event names instead of stretching to the full row;
      // callers can still override
      className={className ?? "w-64"}
      options={events.map((ev) => ({ value: String(ev.id), label: ev.name }))}
    />
  );
}
