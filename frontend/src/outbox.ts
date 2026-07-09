// Offline-first outbox for the finish screen.
//
// Every keypad tap is stored in IndexedDB immediately with a client-generated
// UUID and a local timestamp (the authoritative finish time), then synced to
// the server when online. The server dedupes by client_id, so replaying the
// whole outbox after a connection drop is always safe.

export interface OutboxEntry {
  clientId: string;
  raceId: number;
  bib: number | null;
  recordedAt: string;
  synced: boolean;
}

const DB_NAME = "frontrun-outbox";
const STORE = "finishes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function enqueueFinish(raceId: number, bib: number | null): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    clientId: crypto.randomUUID(),
    raceId,
    bib,
    recordedAt: new Date().toISOString(), // captured at tap time, offline or not
    synced: false,
  };
  await asPromise((await store("readwrite")).put(entry));
  void syncOutbox();
  return entry;
}

export async function pendingEntries(raceId?: number): Promise<OutboxEntry[]> {
  const all = await asPromise((await store("readonly")).getAll() as IDBRequest<OutboxEntry[]>);
  return all.filter((e) => !e.synced && (raceId === undefined || e.raceId === raceId));
}

let syncing = false;

export async function syncOutbox(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await pendingEntries();
    for (const entry of pending) {
      const res = await fetch(`/api/races/${entry.raceId}/finishes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: entry.clientId,
          bib: entry.bib,
          recorded_at: entry.recordedAt,
        }),
      });
      if (!res.ok) break; // offline again or session expired — retry next tick
      await asPromise((await store("readwrite")).put({ ...entry, synced: true }));
    }
  } finally {
    syncing = false;
  }
}

/** Starts background syncing; returns a cleanup function. */
export function startOutboxSync(intervalMs = 5000): () => void {
  const kick = () => void syncOutbox();
  window.addEventListener("online", kick);
  const timer = window.setInterval(kick, intervalMs);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    window.clearInterval(timer);
  };
}
