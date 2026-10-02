// Durable operations and the album's known media hashes in IndexedDB. Confirmed operations are removed after synchronization.

import type { Op, Photo } from '$shared/types';

const DB_NAME = 'infoto';
const DB_VERSION = 2;
const STORE = 'oplog';
const CACHE_STORE = 'metaCache';
/** Survivable upload jobs: enough metadata to resume an upload after a page reload
 *  (the artifact itself is in OPFS). */
const RESUME_STORE = 'pendingUploads';

export interface PendingUploadRecord {
  jobId: string;
  fileName: string;
  sha256: string;
  meta: { width: number; height: number; size: number; type: 0 | 1 | 2 };
  artifactExt: 'webp' | 'webm';
}

/** Open (or upgrade) the database. Factory injection keeps unit tests easy; a missing
 *  `indexedDB` (worker, SSR) resolves to a rejected promise rather than throwing while
 *  the default argument is evaluated. */
export function openOplogDb(factory?: IDBFactory): Promise<IDBDatabase> {
  const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!idb) return Promise.reject(new Error('indexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
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

/** Run `fn` against one store in its own transaction, resolving on completion. */
function withStore<T>(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error(`${name} transaction failed`));
  });
}

/** Append one op; resolves to the new record's autoincrement key, which is the op's
 * version handle: monotonic, persisted with the log, never reused — so confirmation
 * tracking stays correct across reloads and tabs. */
export function appendOp(db: IDBDatabase, op: Op): Promise<IDBValidKey> {
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
export function readOps(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; op: Op }>> {
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

export function countOps(db: IDBDatabase): Promise<number> {
  return withStore(db, STORE, 'readonly', (store) => store.count());
}

/** Clear the oplog for isolated test setup. */
export function clearOps(db: IDBDatabase): Promise<void> {
  return withStore(db, STORE, 'readwrite', (store) => store.clear());
}

// Persist upload metadata so SharedWorker restarts can resume artifacts stored in OPFS.

export async function putPendingUpload(db: IDBDatabase, rec: PendingUploadRecord): Promise<void> {
  await withStore(db, RESUME_STORE, 'readwrite', (store) => store.put(rec));
}

export function deletePendingUpload(db: IDBDatabase, jobId: string): Promise<void> {
  return withStore(db, RESUME_STORE, 'readwrite', (store) => store.delete(jobId));
}

export function readPendingUploads(db: IDBDatabase): Promise<PendingUploadRecord[]> {
  return withStore(db, RESUME_STORE, 'readonly', (store) => store.getAll()).then(
    (rows) => rows as PendingUploadRecord[],
  );
}

// ---- sha cache -----------------------------------------------------------------

/** True when this sha256 already belongs to a photo in the album. */
export function isKnownAlbumSha(db: IDBDatabase, sha256: string): Promise<boolean> {
  return withStore(
    db,
    CACHE_STORE,
    'readonly',
    (store) => store.getKey(sha256) as IDBRequest<IDBValidKey | undefined>,
  ).then((key) => key !== undefined);
}

/** Replace the cache with the snapshot's hashes; the snapshot is the only authority. */
export function rebuildCache(db: IDBDatabase, photos: Photo[]): Promise<void> {
  return withStore(db, CACHE_STORE, 'readwrite', (store) => {
    const cleared = store.clear();
    // Queued after the clear, so every snapshot hash lands in an emptied store.
    for (const photo of photos) store.put(1, photo.sha256);
    return cleared;
  });
}
