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
  // undo pressed before the entry reached the server: the sync still POSTs
  // the finish (idempotent), then PATCHes it to voided — this stays correct
  // even if a previous sync crashed between POST and marking synced.
  voided?: boolean;
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

export async function enqueueFinish(
  raceId: number,
  bib: number | null,
  // defaults to now (a live keypad tap); pass an explicit time to insert a
  // missed finisher at a specific moment ("Eintrag nachtragen")
  recordedAt: string = new Date().toISOString()
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    clientId: crypto.randomUUID(),
    raceId,
    bib,
    recordedAt, // captured at tap time, offline or not
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

/** Undo a tap that has not reached the server yet. */
export async function voidPending(clientId: string): Promise<void> {
  const entry = await asPromise(
    (await store("readonly")).get(clientId) as IDBRequest<OutboxEntry | undefined>
  );
  if (entry && !entry.synced) {
    await asPromise((await store("readwrite")).put({ ...entry, voided: true }));
  }
  void syncOutbox();
}

/** Undo a still-pending void: the entry has not synced yet, so it is simply
 *  un-marked and will POST as a normal finish. */
export async function unvoidPending(clientId: string): Promise<void> {
  const entry = await asPromise(
    (await store("readonly")).get(clientId) as IDBRequest<OutboxEntry | undefined>
  );
  if (entry && !entry.synced && entry.voided) {
    await asPromise((await store("readwrite")).put({ ...entry, voided: false }));
  }
  void syncOutbox();
}

let syncing = false;

export async function syncOutbox(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await pendingEntries();
    for (const entry of pending) {
      try {
        const res = await fetch(`/api/races/${entry.raceId}/finishes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: entry.clientId,
            bib: entry.bib,
            recorded_at: entry.recordedAt,
          }),
        });
        if (!res.ok) break; // session expired or server error — retry next tick
        if (entry.voided) {
          const created = (await res.json()) as { id: number };
          const patched = await fetch(`/api/finishes/${created.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "voided" }),
          });
          if (!patched.ok) break; // retry the whole entry later — POST is idempotent
        }
      } catch {
        break; // network down — retry on the next tick / online event
      }
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
