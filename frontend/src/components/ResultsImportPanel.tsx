// Fallback path: if the app has problems on race day and timing falls back to
// the old Excel workbook, the finish list is uploaded here afterwards and
// becomes what the app shows.
//
// Same three steps as the participant import: choose file → Prüfen (Dry-Run)
// → Übernehmen. Times in the file are NET running times (what the app's own
// results export writes); the bib decides the race, so no race picker is
// needed. "Ersetzen" voids the stored finishes of the affected races — it
// never deletes them, so the original timing stays recoverable.
import { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  translateMessage,
  type EventInfo,
  type ResultsImportReport,
} from "../api";
import type { ConfirmFn } from "../components";
import { FileButton } from "./ui/file-button";
import { SelectField } from "./ui/select-field";

const NONE = "__none__"; // Radix Select forbids empty-string item values

const FIELDS: { key: "bib" | "time"; label: string; guess: RegExp }[] = [
  { key: "bib", label: "Startnummer", guess: /startn|bib|nr/i },
  { key: "time", label: "Laufzeit", guess: /zeit|time|netto/i },
];

const MODES = [
  { value: "replace", label: "Ersetzen — die Datei gilt" },
  { value: "merge", label: "Ergänzen — nur fehlende Zeiten" },
];

export function ResultsImportPanel({
  event,
  confirm,
  onImported,
}: {
  event: EventInfo;
  confirm: ConfirmFn;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("replace");
  const [report, setReport] = useState<ResultsImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (dryRun: boolean, useMapping: Record<string, string>) => {
      if (!file) return null;
      const body = new FormData();
      body.append("file", file);
      body.append("mapping", JSON.stringify(useMapping));
      body.append("mode", mode);
      body.append("dry_run", String(dryRun));
      const res = await fetch(`/api/events/${event.id}/import-results`, {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as ResultsImportReport;
    },
    [file, event.id, mode]
  );

  const onFile = (f: File | null) => {
    setFile(f);
    setReport(null);
    setColumns([]);
    setMapping({});
    setError(null);
  };

  // on file choice: one dry run with an empty mapping just to discover the
  // columns and prefill them — its report ("mapping missing") is not shown
  useEffect(() => {
    if (!file) return;
    upload(true, {})
      .then((rep) => {
        if (!rep) return;
        const guessed: Record<string, string> = {};
        for (const { key, guess } of FIELDS) {
          const hit = rep.columns.find(
            (c) => guess.test(c) && !Object.values(guessed).includes(c)
          );
          if (hit) guessed[key] = hit;
        }
        setMapping(guessed);
        setColumns(rep.columns);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [file, upload]);

  const run = async (dryRun: boolean) => {
    try {
      const rep = await upload(dryRun, mapping);
      setReport(rep);
      setError(null);
      if (rep?.committed) onImported();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const commit = () => {
    const races = report?.races.join(", ") || "diesem Event";
    const consequence =
      mode === "replace"
        ? `Alle bisher in der App erfassten Zieleinläufe von ${races} werden verworfen ` +
          "(als „voided“ markiert, nicht gelöscht) und durch die Zeiten aus der Datei ersetzt."
        : `Die Zeiten aus der Datei werden zu ${races} hinzugefügt. ` +
          "Bereits erfasste Zeiten bleiben unverändert.";
    confirm(
      `${report?.valid_rows ?? 0} Zeiten übernehmen? ${consequence}`,
      () => void run(false)
    );
  };

  const canCommit =
    report !== null && !report.committed && report.errors.length === 0 && report.valid_rows > 0;

  return (
    <details style={{ marginTop: "0.5rem" }}>
      <summary>Ergebnisse aus Excel übernehmen (Notfall-Import)</summary>
      <div className="form-grid" style={{ marginTop: "0.75rem" }}>
        <p style={{ margin: 0 }}>
          <small>
            Für den Fall, dass die App am Renntag streikt und mit der alten Excel-Liste
            gestoppt wurde. Die Datei braucht nur zwei Spalten: <strong>Startnummer</strong> und{" "}
            <strong>Laufzeit</strong> (netto, z.&nbsp;B. <code>0:42:15</code> oder{" "}
            <code>42:15</code>). Das Rennen ergibt sich aus der Startnummer. Hat ein Rennen noch
            keine Startzeit, wird eine gesetzt, damit die Laufzeiten stimmen.
          </small>
        </p>
        <FileButton accept=".xlsx,.numbers,.csv" onFile={onFile} />
        {columns.length > 0 && (
          <>
            {FIELDS.map(({ key, label }) => (
              <div key={key} className="map-field">
                <span className="map-field-label">{label} *</span>
                <SelectField
                  value={mapping[key] ?? NONE}
                  onValueChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (v && v !== NONE) next[key] = v;
                      else delete next[key];
                      return next;
                    })
                  }
                  ariaLabel={label}
                  options={[
                    { value: NONE, label: "— keine Spalte —" },
                    ...columns.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </div>
            ))}
            <div className="map-field">
              <span className="map-field-label">Bestehende Zeiten</span>
              <SelectField
                value={mode}
                onValueChange={(v) => {
                  setMode(v);
                  setReport(null); // the report was for the other mode
                }}
                ariaLabel="Umgang mit bestehenden Zeiten"
                options={MODES}
              />
            </div>
            <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => run(true)}>1. Prüfen (Dry-Run)</button>
              <button className="primary" onClick={commit} disabled={!canCommit}>
                2. Übernehmen
              </button>
              {!canCommit && !report?.committed && (
                <small>
                  {report === null
                    ? "erst prüfen — Übernehmen wird danach freigeschaltet"
                    : report.errors.length > 0
                      ? "Fehler beheben, dann erneut prüfen"
                      : "keine gültigen Zeilen"}
                </small>
              )}
            </span>
          </>
        )}
        {error && <p className="error">{error}</p>}
        {report && (
          <div>
            <p>
              {report.total_rows} Zeilen, {report.valid_rows} gültige Zeiten
              {report.races.length > 0 && ` — betrifft ${report.races.join(", ")}`}
              {report.dropped_columns.length > 0 &&
                ` — E-Mail-Spalten verworfen: ${report.dropped_columns.join(", ")}`}
              {report.committed && ` — ${report.created} übernommen ✓`}
              {report.committed && report.voided > 0 && `, ${report.voided} alte verworfen`}
            </p>
            {report.started_races.length > 0 && (
              <p>
                <small>
                  Startzeit gesetzt für: {report.started_races.join(", ")} (Datum des Events,
                  00:00). Sie dient nur als Bezugspunkt für die importierten Laufzeiten — wird sie
                  nachträglich geändert, verschieben sich alle diese Zeiten.
                </small>
              </p>
            )}
            {report.errors.length > 0 && (
              <ul className="error">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    {e.row > 0 ? `Zeile ${e.row}: ` : ""}
                    {translateMessage(e.message)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
