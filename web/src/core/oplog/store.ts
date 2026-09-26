// IndexedDB op-log: append-only; 256 entries trigger a sync; ops keep accumulating
// during a sync and the log clears on success.

import type { Op } from '$shared/types';

/** Sync threshold: op-log length that triggers an automatic sync. */
export const OPLOG_SYNC_THRESHOLD = 256;

const DB_NAME = 'infoto';
const DB_VERSION = 2;
const STORE = 'oplog';
const CACHE_STORE = 'metaCache';
/** Survivable upload jobs: enough metadata to resume an upload after a page reload
 *  (the artifact itself is in OPFS). */
const RESUME_STORE = 'pendingUploads';

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
      if (!db.objectStoreNames.contains(RESUME_STORE)) {
        db.createObjectStore(RESUME_STORE, { keyPath: 'jobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('oplog open failed'));
  });
}

/** Append one op; resolves to the new record's autoincrement key, which is the op's
 * version handle: monotonic, persisted with the log, never reused — so confirmation
 * tracking stays correct across reloads and tabs (an in-memory counter would not). */
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

/** Clear everything — only called after a successful sync. */
export async function clearOps(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog clear failed'));
  });
}

// ---- resumable uploads ---------------------------------------------------------
// A page reload kills the SharedWorker and with it every in-flight job. The artifact is
// already on disk (OPFS), so the job itself is recoverable — only its metadata is not.
// Storing that metadata here lets the worker rebuild the job and finish the upload, so a
// reload no longer silently drops a photo that was already transcoded.

export interface PendingUploadRecord {
  jobId: string;
  fileName: string;
  sha256: string;
  meta: { width: number; height: number; size: number; type: 0 | 1 | 2 };
  artifactExt: 'webp' | 'webm';
}

export async function putPendingUpload(db: IDBDatabase, rec: PendingUploadRecord): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RESUME_STORE, 'readwrite');
    tx.objectStore(RESUME_STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('pending upload write failed'));
  });
}

export async function deletePendingUpload(db: IDBDatabase, jobId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RESUME_STORE, 'readwrite');
    tx.objectStore(RESUME_STORE).delete(jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('pending upload delete failed'));
  });
}

export async function readPendingUploads(db: IDBDatabase): Promise<PendingUploadRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESUME_STORE, 'readonly');
    const req = tx.objectStore(RESUME_STORE).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as PendingUploadRecord[]);
    req.onerror = () => reject(req.error ?? new Error('pending upload read failed'));
  });
}
