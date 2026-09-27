// IndexedDB op-log and the sha→photo cache. Ops are append-only; 256 entries trigger a
// sync, and the log clears on success. The cache maps album/editor image hashes to
// their photo rows so a re-upload of the same bytes is recognised.

import type { Op, Photo } from '$shared/types';

/** Sync threshold: op-log length that triggers an automatic sync. */
export const OPLOG_SYNC_THRESHOLD = 256;

const DB_NAME = 'infoto';
const DB_VERSION = 2;
const STORE = 'oplog';
const CACHE_STORE = 'metaCache';
/** Survivable upload jobs: enough metadata to resume an upload after a page reload
 *  (the artifact itself is in OPFS). */
const RESUME_STORE = 'pendingUploads';

export interface ShaEntry {
  sha256: string;
  purpose: 'album' | 'editor';
  photoId: number | null;
  url?: string;
}

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

/** Clear everything — only called after a successful sync. */
export function clearOps(db: IDBDatabase): Promise<void> {
  return withStore(db, STORE, 'readwrite', (store) => store.clear());
}

// ---- resumable uploads ---------------------------------------------------------
// A page reload kills the SharedWorker and with it every in-flight job. The artifact is
// already on disk (OPFS), so the job itself is recoverable — only its metadata is not.
// Storing that metadata here lets the worker rebuild the job and finish the upload, so a
// reload no longer silently drops a photo that was already transcoded.

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

function cacheKey(purpose: ShaEntry['purpose'], sha256: string): string {
  return `${purpose}:${sha256}`;
}

export function lookupSha(
  db: IDBDatabase,
  purpose: ShaEntry['purpose'],
  sha256: string,
): Promise<ShaEntry | undefined> {
  return withStore(
    db,
    CACHE_STORE,
    'readonly',
    (store) => store.get(cacheKey(purpose, sha256)) as IDBRequest<ShaEntry | undefined>,
  );
}

export function putSha(
  db: IDBDatabase,
  purpose: ShaEntry['purpose'],
  sha256: string,
  photoId: number | null,
  url?: string,
): Promise<void> {
  return withStore(db, CACHE_STORE, 'readwrite', (store) =>
    store.put({ sha256, purpose, photoId, ...(url ? { url } : {}) }, cacheKey(purpose, sha256)),
  ).then(() => undefined);
}

/** Rebuild the album entries from the current snapshot, keeping editor entries. */
export function rebuildCache(db: IDBDatabase, photos: Photo[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.openCursor();
    const editorEntries: ShaEntry[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const entry = cursor.value as ShaEntry;
        if (entry.purpose === 'editor') editorEntries.push(entry);
        cursor.continue();
        return;
      }
      store.clear();
      for (const photo of photos) {
        store.put(
          { sha256: photo.sha256, purpose: 'album', photoId: photo.id, url: photo.url },
          cacheKey('album', photo.sha256),
        );
      }
      for (const entry of editorEntries) {
        store.put(entry, cacheKey('editor', entry.sha256));
      }
    };
    request.onerror = () => reject(request.error ?? new Error('metaCache scan failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('metaCache rebuild failed'));
  });
}
