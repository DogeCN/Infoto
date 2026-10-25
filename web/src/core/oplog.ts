// Durable client state: the ordered op log, and one record per photo keyed by its sha256.
// Confirmed operations and their records are removed after synchronization.
//
// The two stores are written together where they must agree: `appendUpload` appends the upload
// op and marks the photo `hosted` in one transaction, so there is no window in which a photo is
// on the host with no durable trace on either side.

import type { MediaType, Op, SyncResponse } from '$shared/types';
import type { MarkSet } from './ops';

const DB_NAME = 'infoto';
/** 3 replaced the jobId-keyed resume store with the per-photo records below. */
const DB_VERSION = 3;
const STORE = 'oplog';
const CACHE_STORE = 'metaCache';
const PHOTO_STORE = 'photos';
/** Reserved metaCache key holding the last full /sync snapshot. Album hashes are 64 hex
 *  characters, so this word can never collide with one. */
const SNAPSHOT_KEY = 'snapshot';
/** Store the previous version used for resumable uploads; 3 absorbed it into `photos`. */
const LEGACY_RESUME_STORE = 'pendingUploads';

/**
 * Everything the client durably knows about one photo that is not yet in the album, keyed by
 * the photo's own sha256 — the same address every op uses.
 *
 * One record replaces three former stores (a jobId-keyed resume record, the localStorage mark
 * set, the sessionStorage sort stamp), which is what keeps their lifetimes honest: deleting the
 * record deletes all of it. `jobId` survives only as `artifact.key`, because the OPFS file name
 * has to exist before its own digest does.
 */
export interface PhotoRecord {
  sha256: string;
  /** `uploading` = resume material, `hosted` = a queued upload op owns it, `failed` = the upload
   *  leg was rejected and a retry can still reuse the artifact. */
  status: 'uploading' | 'hosted' | 'failed';
  /** Stage-1 artifact metadata, present once the bytes are on disk. */
  meta?: { width: number; height: number; size: number; type: MediaType };
  fileName?: string;
  /** OPFS artifact handle: the file is `{key}.{ext}`. */
  artifact?: { key: string; ext: 'webp' | 'webm' };
  /** The hosted URL the facade returned. Set when `status` becomes `hosted`. */
  url?: string;
  /** When the facade returned `url` (ms epoch) — the photo's own timestamp, and what orders it. */
  createdAt?: number;
  /** Failure code, so a reloaded card reports the original reason. */
  error?: string;
  /** Optimistic marks made before the album has the row. */
  marks?: MarkSet;
  /** The upload op this record owns, so withdrawing the photo deletes exactly that op. */
  opKey?: IDBValidKey;
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
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: 'sha256' });
      }
      // Nothing to migrate: a v2 resume record is about a transfer this build cannot describe.
      if (db.objectStoreNames.contains(LEGACY_RESUME_STORE)) {
        db.deleteObjectStore(LEGACY_RESUME_STORE);
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

/**
 * Persist a photo's upload op and its record together: the op is what the server will apply, the
 * record is what the page renders until it does. One transaction, because a photo that reached
 * the host with only one of the two halves written is exactly the state that has no recovery.
 */
export function appendUpload(db: IDBDatabase, op: Op, record: PhotoRecord): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, PHOTO_STORE], 'readwrite');
    const added = tx.objectStore(STORE).add(op);
    added.onsuccess = () => {
      // Same transaction, so the key is already known to the record that owns it.
      tx.objectStore(PHOTO_STORE).put({ ...record, status: 'hosted', opKey: added.result });
    };
    tx.oncomplete = () => resolve(added.result);
    tx.onerror = () => reject(tx.error ?? new Error('oplog appendUpload failed'));
  });
}

/** Overwrite one queued operation in place, keeping its key — and with it its position in the
 *  log, which is what makes superseding a queued op order-safe. */
export function putOp(db: IDBDatabase, key: IDBValidKey, op: Op): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(op, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog putOp failed'));
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

// ---- photo records ----------------------------------------------------------------

/** Every photo record, in insertion order (upload order). */
export function readPhotoRecords(db: IDBDatabase): Promise<PhotoRecord[]> {
  return withStore(db, PHOTO_STORE, 'readonly', (store) => store.getAll()).then(
    (rows) => rows as PhotoRecord[],
  );
}

/** One photo's record, or null when the client knows nothing about it. */
export function readPhotoRecord(db: IDBDatabase, sha256: string): Promise<PhotoRecord | null> {
  return withStore(
    db,
    PHOTO_STORE,
    'readonly',
    (store) => store.get(sha256) as IDBRequest<PhotoRecord | undefined>,
  ).then((row) => row ?? null);
}

/** Insert or replace a record (the worker writes `uploading` / `failed`). */
export function putPhotoRecord(db: IDBDatabase, record: PhotoRecord): Promise<void> {
  return withStore(db, PHOTO_STORE, 'readwrite', (store) => store.put(record)).then(
    () => undefined,
  );
}

/** Read, change and write one record in a single transaction; a missing record is a no-op, so a
 *  late write cannot resurrect a photo that was confirmed or withdrawn meanwhile. */
export function updatePhotoRecord(
  db: IDBDatabase,
  sha256: string,
  mutate: (record: PhotoRecord) => PhotoRecord,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    const got = store.get(sha256) as IDBRequest<PhotoRecord | undefined>;
    got.onsuccess = () => {
      const record = got.result;
      if (record) store.put(mutate(record));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog updatePhotoRecord failed'));
  });
}

export function deletePhotoRecord(db: IDBDatabase, sha256: string): Promise<void> {
  return withStore(db, PHOTO_STORE, 'readwrite', (store) => store.delete(sha256));
}

/** Drop the records of photos the server has confirmed (or that a sync has retired). */
export function deletePhotoRecords(db: IDBDatabase, shas: readonly string[]): Promise<void> {
  if (shas.length === 0) return Promise.resolve();
  return withStore(db, PHOTO_STORE, 'readwrite', (store) => {
    for (const sha of shas) store.delete(sha);
    return store.count();
  }).then(() => undefined);
}

/**
 * Withdraw a photo the user deleted: its record, the mark ops addressed to it, and the upload op
 * the record owns, in one transaction. The upload op is deleted by its own key rather than by
 * scanning for a sha it does not carry, which is what makes the withdrawal exact; the tombstone
 * `delete` op filed afterwards still covers an op an in-flight request already took.
 */
export function removePhoto(db: IDBDatabase, sha256: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, PHOTO_STORE], 'readwrite');
    const log = tx.objectStore(STORE);
    const records = tx.objectStore(PHOTO_STORE);
    const got = records.get(sha256) as IDBRequest<PhotoRecord | undefined>;
    got.onsuccess = () => {
      const record = got.result;
      if (record?.opKey !== undefined) log.delete(record.opKey);
      records.delete(sha256);
      const cursorReq = log.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const op = cursor.value as Op;
        // An upload op carries no sha of its own; every other photo op does.
        if (op.type !== 'upload' && op.targetSha === sha256) cursor.delete();
        cursor.continue();
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog removePhoto failed'));
  });
}

// ---- sha cache + snapshot ---------------------------------------------------------

/** True when this sha256 already belongs to a photo in the album. */
export function isKnownAlbumSha(db: IDBDatabase, sha256: string): Promise<boolean> {
  return withStore(
    db,
    CACHE_STORE,
    'readonly',
    (store) => store.getKey(sha256) as IDBRequest<IDBValidKey | undefined>,
  ).then((key) => key !== undefined);
}

/** Replace the cache with the snapshot: one entry per hash for dedupe, plus the snapshot
 *  itself so the next open can render the album before the network answers. The snapshot is
 *  the only authority. */
export function rebuildCache(db: IDBDatabase, snapshot: SyncResponse): Promise<void> {
  return withStore(db, CACHE_STORE, 'readwrite', (store) => {
    const cleared = store.clear();
    // Queued after the clear, so every snapshot hash lands in an emptied store.
    for (const photo of snapshot.photos) store.put(1, photo.sha256);
    store.put(snapshot, SNAPSHOT_KEY);
    return cleared;
  });
}

/** The last full /sync snapshot, or null when this device has never completed a sync. */
export function readSnapshot(db: IDBDatabase): Promise<SyncResponse | null> {
  return withStore(
    db,
    CACHE_STORE,
    'readonly',
    (store) => store.get(SNAPSHOT_KEY) as IDBRequest<SyncResponse | undefined>,
  ).then((value) => value ?? null);
}
