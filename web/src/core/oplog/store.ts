// IndexedDB op-log (spec: "/sync protocol"): append-only; 256 entries trigger a
// sync; ops keep accumulating during a sync and the log clears on success.

import type { Op } from '$shared/types';

/** Sync threshold: op-log length that triggers an automatic sync. */
export const OPLOG_SYNC_THRESHOLD = 256;

const DB_NAME = 'infoto';
const DB_VERSION = 1;
const STORE = 'oplog';
const CACHE_STORE = 'metaCache';

export type OpLogListener = (count: number) => void;

/** Open (or upgrade) the database. Factory injection keeps unit tests easy. */
export function openOplogDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('oplog open failed'));
  });
}

/**
 * Append one op; resolves to the new record's autoincrement key, which is the op's
 * version handle: monotonic, persisted with the log, never reused — so confirmation
 * tracking stays correct across reloads and tabs (an in-memory counter would not).
 */
export async function appendOp(db: IDBDatabase, op: Op): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    let key: IDBValidKey | undefined;
    const req = tx.objectStore(STORE).add(op);
    req.onsuccess = () => {
      key = req.result;
    };
    tx.oncomplete = () => resolve(key as IDBValidKey);
    tx.onerror = () => reject(tx.error ?? new Error('oplog append failed'));
  });
}

/** Read all pending ops in submission order. */
export async function readOps(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; op: Op }>> {
  return new Promise((resolve, reject) => {
    const out: Array<{ key: IDBValidKey; op: Op }> = [];
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push({ key: cursor.key, op: cursor.value as Op });
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error ?? new Error('oplog read failed'));
  });
}

export async function countOps(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('oplog count failed'));
  });
}

/** Clear everything — only called after a successful sync (spec). */
export async function clearOps(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog clear failed'));
  });
}

/** Delete all records below (exclusive) a key — precise cleanup after incremental submits. */
export async function deleteOpsBelow(db: IDBDatabase, upperKey: IDBValidKey): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const range = IDBKeyRange.upperBound(upperKey, true);
    tx.objectStore(STORE).delete(range);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog delete failed'));
  });
}
