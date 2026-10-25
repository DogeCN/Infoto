// Durable client state: the ordered op log, and one record per photo keyed by its sha256.
// Confirmed operations and their records are removed after synchronization.
//
// The two stores are written together where they must agree: `appendUpload` appends the upload
// op and marks the photo `hosted` in one transaction, so there is no window in which a photo is
// on the host with no durable trace on either side, and `retirePhotos` states the marks a
// confirmed record still carries before it deletes it, so the retirement cannot swallow them.

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
/** The ops a pending photo's marks are stated as, with the field each one reads. */
const MARK_OPS = [
  ['like', 'likes'],
  ['dislike', 'dislikes'],
  ['report', 'reports'],
] as const;

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

/**
 * Open (or upgrade) the database.
 *
 * Both failure modes are reported rather than left pending: a `blocked` upgrade (another tab
 * still holds an older version) rejects, so a caller's `.catch` runs and the user sees why
 * instead of an app that never finishes opening; a `versionchange` closes this connection, so a
 * tab on this build never becomes the blocker for the next one.
 */
export function openOplogDb(): Promise<IDBDatabase> {
  const idb = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (!idb) return Promise.reject(new Error('indexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
    req.onblocked = () => reject(new Error('idb_blocked'));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('oplog open failed'));
  });
}

/**
 * Run one transaction and settle with it, once.
 *
 * Two failures are easy to get wrong and both end as a hang: a transaction that aborts fires
 * `abort`, not `error`, and a closed connection throws synchronously from `db.transaction` —
 * which every caller of this module, written as `await x()` or `x().catch(...)`, would see as a
 * thrown exception instead of a rejection. Both are funnelled through here.
 */
function run<T>(
  db: IDBDatabase,
  names: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let done: () => T;
    try {
      tx = db.transaction(names, mode);
      done = work(tx);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    tx.oncomplete = () => settle(() => resolve(done()));
    tx.onerror = () => settle(() => reject(tx.error ?? new Error('transaction failed')));
    tx.onabort = () => settle(() => reject(tx.error ?? new Error('transaction aborted')));
  });
}
/** Append one op; resolves to the new record's autoincrement key, which is the op's
 *  version handle: monotonic, persisted with the log, never reused — so confirmation
 *  tracking stays correct across reloads and tabs. */
export function appendOp(db: IDBDatabase, op: Op): Promise<IDBValidKey> {
  return run(db, STORE, 'readwrite', (tx) => {
    const req = tx.objectStore(STORE).add(op);
    return () => req.result;
  });
}

/**
 * Persist a photo's upload op and its record together: the op is what the server will apply, the
 * record is what the page renders until it does. One transaction, because a photo that reached
 * the host with only one of the two halves written is exactly the state that has no recovery.
 */
export function appendUpload(db: IDBDatabase, op: Op, record: PhotoRecord): Promise<IDBValidKey> {
  return run(db, [STORE, PHOTO_STORE], 'readwrite', (tx) => {
    const added = tx.objectStore(STORE).add(op);
    added.onsuccess = () => {
      try {
        // Same transaction, so the key is already known to the record that owns it.
        tx.objectStore(PHOTO_STORE).put({ ...record, status: 'hosted', opKey: added.result });
      } catch (error) {
        // A record that cannot be stored must take its op down with it: half a pair is the state
        // with no recovery, and an exception here would otherwise let the op commit alone.
        tx.abort();
        console.error('[oplog] upload record rejected, rolling the op back', error);
      }
    };
    return () => added.result;
  });
}

/** Overwrite one queued operation in place, keeping its key — and with it its position in the
 *  log, which is what makes superseding a queued op order-safe. */
export function putOp(db: IDBDatabase, key: IDBValidKey, op: Op): Promise<void> {
  return run(db, STORE, 'readwrite', (tx) => {
    tx.objectStore(STORE).put(op, key);
    return () => undefined;
  });
}

/** Read all pending ops in submission order. */
export function readOps(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; op: Op }>> {
  return run(db, STORE, 'readonly', (tx) => {
    const out: Array<{ key: IDBValidKey; op: Op }> = [];
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push({ key: cursor.key, op: cursor.value as Op });
        cursor.continue();
      }
    };
    return () => out;
  });
}

export function countOps(db: IDBDatabase): Promise<number> {
  return run(db, STORE, 'readonly', (tx) => {
    const req = tx.objectStore(STORE).count();
    return () => req.result;
  });
}

/** Delete the ops a confirmed batch carried, by their own keys. */
export function deleteOps(db: IDBDatabase, keys: readonly IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return run(db, STORE, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE);
    for (const key of keys) store.delete(key);
    return () => undefined;
  });
}

/** Clear the oplog for isolated test setup. */
export function clearOps(db: IDBDatabase): Promise<void> {
  return run(db, STORE, 'readwrite', (tx) => {
    tx.objectStore(STORE).clear();
    return () => undefined;
  });
}

// ---- photo records ----------------------------------------------------------------

/** Every photo record in upload order. The store is keyed by sha, so it reads back in hash
 *  order; `createdAt` is what the cards and the worker resume are ordered by. */
export function readPhotoRecords(db: IDBDatabase): Promise<PhotoRecord[]> {
  return run(db, PHOTO_STORE, 'readonly', (tx) => {
    const req = tx.objectStore(PHOTO_STORE).getAll();
    return () =>
      (req.result as PhotoRecord[]).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  });
}

/** One photo's record, or null when the client knows nothing about it. */
export function readPhotoRecord(db: IDBDatabase, sha256: string): Promise<PhotoRecord | null> {
  return run(db, PHOTO_STORE, 'readonly', (tx) => {
    const req = tx.objectStore(PHOTO_STORE).get(sha256) as IDBRequest<PhotoRecord | undefined>;
    return () => req.result ?? null;
  });
}

/** Insert or replace a record (test seeding; production writes go through the helpers below). */
export function putPhotoRecord(db: IDBDatabase, record: PhotoRecord): Promise<void> {
  return run(db, PHOTO_STORE, 'readwrite', (tx) => {
    tx.objectStore(PHOTO_STORE).put(record);
    return () => undefined;
  });
}

/**
 * Read, change and write one record in a single transaction, so a writer can change one field
 * without owning the others (marks, `opKey` and the URL are written by different actors).
 *
 * `create` runs when there is no record yet; without it a missing record is a no-op, so a late
 * write cannot resurrect a photo that was confirmed or withdrawn meanwhile.
 */
export function updatePhotoRecord(
  db: IDBDatabase,
  sha256: string,
  mutate: (record: PhotoRecord) => PhotoRecord,
  create?: () => PhotoRecord | null,
): Promise<void> {
  return run(db, PHOTO_STORE, 'readwrite', (tx) => {
    const store = tx.objectStore(PHOTO_STORE);
    const got = store.get(sha256) as IDBRequest<PhotoRecord | undefined>;
    got.onsuccess = () => {
      const record = got.result;
      try {
        if (record) store.put(mutate(record));
        else if (create) {
          const fresh = create();
          if (fresh) store.put(fresh);
        }
      } catch (error) {
        tx.abort();
        console.error('[oplog] photo record update rejected', error);
      }
    };
    return () => undefined;
  });
}

export function deletePhotoRecord(db: IDBDatabase, sha256: string): Promise<void> {
  return deletePhotoRecords(db, [sha256]);
}

/**
 * Delete a record only while the job that wrote it still owns its artifact.
 *
 * Records are keyed by sha but jobs by job id, and a stale job for the same file outlives the
 * record a newer job replaced it with: deleting by sha alone would take the newer photo's card,
 * `opKey` and marks with it.
 */
export function deletePhotoRecordIfOwned(
  db: IDBDatabase,
  sha256: string,
  jobId: string,
): Promise<void> {
  return run(db, PHOTO_STORE, 'readwrite', (tx) => {
    const store = tx.objectStore(PHOTO_STORE);
    const got = store.get(sha256) as IDBRequest<PhotoRecord | undefined>;
    got.onsuccess = () => {
      if (got.result?.artifact?.key === jobId) store.delete(sha256);
    };
    return () => undefined;
  });
}

/** Drop the records of photos the server has confirmed. */
export function deletePhotoRecords(db: IDBDatabase, shas: readonly string[]): Promise<void> {
  if (shas.length === 0) return Promise.resolve();
  return run(db, PHOTO_STORE, 'readwrite', (tx) => {
    const store = tx.objectStore(PHOTO_STORE);
    for (const sha of shas) store.delete(sha);
    return () => undefined;
  });
}

/**
 * Retire the records a confirmed sync no longer needs, stating the marks they still carry first.
 *
 * The record is the last owner of an optimistic mark, and only the page's in-memory map used to
 * state it as an op — so a client that never hydrated (the admin route, a tab whose read lost a
 * race) lost the mark when the record went. Stating them here makes the retirement
 * self-sufficient; a repeat op on the same dimension is coalesced in place when the page also
 * states them, so doing it twice costs nothing.
 */
export function retirePhotos(
  db: IDBDatabase,
  shas: readonly string[],
  selfId: number,
): Promise<void> {
  if (shas.length === 0) return Promise.resolve();
  return run(db, [STORE, PHOTO_STORE], 'readwrite', (tx) => {
    const log = tx.objectStore(STORE);
    const records = tx.objectStore(PHOTO_STORE);
    for (const sha of shas) {
      const got = records.get(sha) as IDBRequest<PhotoRecord | undefined>;
      got.onsuccess = () => {
        const record = got.result;
        records.delete(sha);
        if (!record?.marks) return;
        for (const [type, field] of MARK_OPS) {
          if (record.marks[field].includes(selfId)) log.add({ type, targetSha: sha });
        }
      };
    }
    return () => undefined;
  });
}

/**
 * Withdraw photos the user deleted: each record, the mark ops addressed to it and the upload op
 * the record owns, in one transaction for the whole selection.
 *
 * The upload op is deleted by its own key rather than by scanning for a sha it does not carry,
 * which is what makes the withdrawal exact; the tombstone `delete` op filed afterwards still
 * covers an op an in-flight request already took. One cursor pass serves the whole selection,
 * because scanning the log per photo made a hundred-photo delete a hundred scans.
 */
export function removePhotos(db: IDBDatabase, shas: readonly string[]): Promise<void> {
  if (shas.length === 0) return Promise.resolve();
  return run(db, [STORE, PHOTO_STORE], 'readwrite', (tx) => {
    const log = tx.objectStore(STORE);
    const records = tx.objectStore(PHOTO_STORE);
    const removing = new Set(shas);
    for (const sha of shas) {
      const got = records.get(sha) as IDBRequest<PhotoRecord | undefined>;
      got.onsuccess = () => {
        const record = got.result;
        if (record?.opKey !== undefined) log.delete(record.opKey);
        records.delete(sha);
      };
    }
    const cursorReq = log.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const op = cursor.value as Op;
      // An upload op carries no sha of its own; every other photo op does.
      if (op.type !== 'upload' && op.targetSha && removing.has(op.targetSha)) cursor.delete();
      cursor.continue();
    };
    return () => undefined;
  });
}

// ---- sha cache + snapshot ---------------------------------------------------------

/** True when this sha256 already belongs to a photo in the album. */
export function isKnownAlbumSha(db: IDBDatabase, sha256: string): Promise<boolean> {
  return run(db, CACHE_STORE, 'readonly', (tx) => {
    const req = tx.objectStore(CACHE_STORE).getKey(sha256);
    return () => req.result !== undefined;
  });
}

/** Replace the cache with the snapshot: one entry per hash for dedupe, plus the snapshot
 *  itself so the next open can render the album before the network answers. The snapshot is
 *  the only authority. */
export function rebuildCache(db: IDBDatabase, snapshot: SyncResponse): Promise<void> {
  return run(db, CACHE_STORE, 'readwrite', (tx) => {
    const store = tx.objectStore(CACHE_STORE);
    store.clear();
    // Queued after the clear, so every snapshot hash lands in an emptied store.
    for (const photo of snapshot.photos) store.put(1, photo.sha256);
    store.put(snapshot, SNAPSHOT_KEY);
    return () => undefined;
  });
}

/** The last full /sync snapshot, or null when this device has never completed a sync. */
export function readSnapshot(db: IDBDatabase): Promise<SyncResponse | null> {
  return run(db, CACHE_STORE, 'readonly', (tx) => {
    const req = tx.objectStore(CACHE_STORE).get(SNAPSHOT_KEY);
    return () => (req.result as SyncResponse | undefined) ?? null;
  });
}

/** The shas an op list uploads, in order. An upload op carries its sha in the payload: it has no
 *  `targetSha`, because it is addressed before the row — and so the sha index — exists. */
export function uploadOpShas(ops: readonly Op[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.type !== 'upload') continue;
    const sha = (op.payload as { sha256?: unknown } | null | undefined)?.sha256;
    if (typeof sha === 'string' && sha) out.push(sha);
  }
  return out;
}
