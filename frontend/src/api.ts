export interface Race {
  id: number;
  event_id: number;
  name: string;
  status: "pending" | "running" | "finished";
  started_at: string | null;
}

export interface EventInfo {
  id: number;
  name: string;
  date: string;
  is_published: boolean;
  races: Race[];
}

export interface ResultRow {
  category: string;
  rank: number;
  bib: number;
  name: string;
  birth_year: number | null;
  club: string | null;
  elapsed_seconds: number;
  time: string;
  changed_at: string;
}

export interface ResultsOut {
  event_id: number;
  categories: string[];
  results: ResultRow[];
  server_time: string;
}

export interface FinishOut {
  id: number;
  race_id: number;
  bib: number | null;
  recorded_at: string;
  client_id: string;
  status: "ok" | "unassigned" | "voided" | "conflict";
  created_by: string;
  participant_name: string | null;
  elapsed_seconds: number | null;
}

export interface Participant {
  id: number;
  race_id: number;
  bib: number;
  first_name: string;
  last_name: string;
  gender: "m" | "w" | "x";
  birth_year: number | null;
  club: string | null;
  pair_group: string | null;
  source: "import" | "day_of";
}

export interface ImportReport {
  total_rows: number;
  valid_rows: number;
  errors: { row: number; message: string }[];
  dropped_columns: string[];
  columns: string[];
  created: number;
  committed: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** local datetime string for <input type="datetime-local"> */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
