import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Op, SyncResponse } from '$shared/types';
import {
  appendOp,
  appendUpload,
  clearOps,
  countOps,
  isKnownAlbumSha,
  openOplogDb,
  readOps,
  readPhotoRecord,
  readPhotoRecords,
  readSnapshot,
  putPhotoRecord,
  rebuildCache,
  removePhotos,
  retirePhotos,
  deletePhotoRecordIfOwned,
  updatePhotoRecord,
  type PhotoRecord,
} from '../../src/core/oplog';

const op = (i: number) => ({ type: 'like' as const, target: i, payload: null });
const snapshot = (...ids: number[]): SyncResponse =>
  ({
    ok: true,
    serverTime: 0,
    selfId: 0,
    mediaHostUrl: 'https://facade.test',
    photos: ids.map((id) => ({ id, sha256: `sha-${id}` })),
    announcements: [],
    polls: [],
    feedback: [],
  }) as never;

async function freshDb(): Promise<IDBDatabase> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('infoto');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  return openOplogDb();
}

test('appends, clears, and replaces the known-hash cache wholesale', async () => {
  const db = await freshDb();
  try {
    assert.equal(await countOps(db), 0);
    await appendOp(db, op(1));
    await appendOp(db, op(2));
    assert.equal(await countOps(db), 2);
    assert.deepEqual(
      (await readOps(db)).map((e) => e.op.target as number),
      [1, 2],
    );
    await clearOps(db);
    assert.equal(await countOps(db), 0);

    // The snapshot is the only authority: a rebuild both adds and drops hashes, and it
    // leaves the full snapshot behind for the next open to render from.
    await rebuildCache(db, snapshot(1, 2));
    assert.equal(await isKnownAlbumSha(db, 'sha-1'), true);
    assert.equal(await isKnownAlbumSha(db, 'missing'), false);
    assert.equal((await readSnapshot(db))?.photos.length, 2);
    await rebuildCache(db, snapshot(2));
    assert.equal(await isKnownAlbumSha(db, 'sha-1'), false);
    assert.equal(await isKnownAlbumSha(db, 'sha-2'), true);
    assert.deepEqual(
      (await readSnapshot(db))?.photos.map((p) => p.id),
      [2],
    );
  } finally {
    db.close();
  }
});

test('a photo record and its upload op are written together, and withdrawn together', async () => {
  const db = await freshDb();
  try {
    const upload = (sha: string): Op => ({
      type: 'upload',
      target: null,
      payload: { sha256: sha, url: `https://host/${sha}.webp` },
    });
    const record = (sha: string): PhotoRecord => ({
      sha256: sha,
      status: 'uploading',
      meta: { width: 8, height: 6, size: 10, type: 0 },
      artifact: { key: `job-${sha}`, ext: 'webp' },
      url: `https://host/${sha}.webp`,
      createdAt: 1_000,
    });

    // One transaction: the op the server will apply and the record the page draws.
    const key = await appendUpload(db, upload('sha-a'), record('sha-a'));
    const hosted = await readPhotoRecord(db, 'sha-a');
    assert.equal(hosted?.status, 'hosted');
    assert.equal(hosted?.opKey, key);
    assert.equal(hosted?.url, 'https://host/sha-a.webp');

    // Mark ops for the same sha, one unrelated op, and a second photo.
    await appendOp(db, { type: 'like', targetSha: 'sha-a', payload: null });
    await appendOp(db, { type: 'like', target: 7, payload: null });
    await appendUpload(db, upload('sha-b'), record('sha-b'));
    assert.equal((await readPhotoRecords(db)).length, 2);

    // Withdrawal deletes the record, its mark ops and the upload op it owns — by that op's own
    // key, since an upload op carries no sha to scan for.
    await removePhotos(db, ['sha-a']);
    assert.equal(await readPhotoRecord(db, 'sha-a'), null);
    // An upload op carries its sha in the payload, never as `targetSha`.
    const label = (o: Op): unknown =>
      o.targetSha ?? (o.payload as { sha256?: string } | null)?.sha256 ?? o.target;
    assert.deepEqual(
      (await readOps(db)).map((e) => label(e.op)),
      [7, 'sha-b'],
    );
    // Withdrawing something already gone is a no-op.
    await removePhotos(db, ['sha-a']);
    assert.equal(await countOps(db), 2);
  } finally {
    db.close();
  }
});

// The upgrade is the one moment the client throws durable state away, so it is asserted rather
// than assumed: a v2 database (three stores, a queued op, a resume record) opens at v3 with the
// op log intact, the resume store gone, and the record store empty.
test('opening a v2 database upgrades to v3 and discards only the resume store', async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('infoto');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  const v2 = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('infoto', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('oplog', { autoIncrement: true });
      db.createObjectStore('metaCache');
      db.createObjectStore('pendingUploads', { keyPath: 'jobId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = v2.transaction(['oplog', 'pendingUploads'], 'readwrite');
    tx.objectStore('oplog').add({ type: 'like', targetSha: 'sha-a', payload: null });
    tx.objectStore('pendingUploads').put({
      jobId: 'job-a',
      fileName: 'a.png',
      sha256: 'sha-a',
      meta: { width: 2, height: 2, size: 3, type: 0 },
      artifactExt: 'webp',
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  v2.close();

  const upgraded = await openOplogDb();
  try {
    assert.equal(upgraded.version, 3);
    assert.deepEqual([...upgraded.objectStoreNames].sort(), ['metaCache', 'oplog', 'photos']);
    // The queue is the one thing the upgrade must not cost: it is what the server has not seen.
    assert.deepEqual(
      (await readOps(upgraded)).map((entry) => entry.op.targetSha),
      ['sha-a'],
    );
    // Nothing is migrated out of the resume store; unsent marks and interrupted uploads are the
    // documented loss (ADR 0025, project red line 1).
    assert.deepEqual(await readPhotoRecords(upgraded), []);
  } finally {
    upgraded.close();
  }
});

// "One transaction" is the whole claim behind the durable pair, so it is asserted from the
// failing side too: a record that cannot be stored must take its upload op down with it. Half a
// pair is the state that has no recovery — an op the server applies with no card to show for it,
// or a card with no op behind it.
test('a record that cannot be stored rolls its upload op back', async () => {
  const db = await freshDb();
  try {
    const op: Op = { type: 'upload', target: null, payload: { sha256: 'sha-a' } };
    // A function is not structured-cloneable, so the put throws inside the transaction.
    const unstorable = {
      sha256: 'sha-a',
      status: 'hosted',
      meta: { width: 1, height: 1, size: 1, type: 0 },
      artifact: { key: 'job-a', ext: 'webp' },
      url: 'https://host/a.webp',
      createdAt: 1_000,
      marks: { likes: [], dislikes: [], reports: [], fn: () => undefined },
    } as unknown as PhotoRecord;
    await assert.rejects(() => appendUpload(db, op, unstorable));
    assert.equal(await countOps(db), 0, 'the op went back with the record');
    assert.deepEqual(await readPhotoRecords(db), []);
  } finally {
    db.close();
  }
});

// The retirement states the marks the record still owns, because the record is their last
// durable home: a client that never hydrated its in-memory mark map (the admin route, a tab whose
// read lost a race) would otherwise lose a mark that was never an op.
test('retiring a confirmed photo states its marks before the record goes', async () => {
  const db = await freshDb();
  try {
    const upload: Op = { type: 'upload', target: null, payload: { sha256: 'sha-a' } };
    await appendUpload(db, upload, {
      sha256: 'sha-a',
      status: 'hosted',
      meta: { width: 1, height: 1, size: 1, type: 0 },
      artifact: { key: 'job-a', ext: 'webp' },
      url: 'https://host/a.webp',
      createdAt: 1_000,
    });
    const marks = { likes: [7], dislikes: [], reports: [7] };
    await updatePhotoRecord(db, 'sha-a', (record) => ({ ...record, marks }));

    // The observer is user 7: both marks are stated, for this photo only.
    await retirePhotos(db, ['sha-a'], 7);
    assert.equal(await readPhotoRecord(db, 'sha-a'), null);
    assert.deepEqual(
      (await readOps(db))
        .filter((entry) => entry.op.type !== 'upload')
        .map((entry) => [entry.op.type, entry.op.targetSha]),
      [
        ['like', 'sha-a'],
        ['report', 'sha-a'],
      ],
    );

    // A record whose marks belong to another user states nothing.
    await appendUpload(db, upload, {
      sha256: 'sha-b',
      status: 'hosted',
      meta: { width: 1, height: 1, size: 1, type: 0 },
      artifact: { key: 'job-b', ext: 'webp' },
      createdAt: 2_000,
      marks: { likes: [9], dislikes: [], reports: [] },
    });
    await retirePhotos(db, ['sha-b'], 7);
    assert.equal((await readOps(db)).filter((e) => e.op.targetSha === 'sha-b').length, 0);
  } finally {
    db.close();
  }
});

test('a record is deleted only while the job that wrote it still owns it', async () => {
  const db = await freshDb();
  try {
    const record: PhotoRecord = {
      sha256: 'sha-a',
      status: 'hosted',
      meta: { width: 1, height: 1, size: 1, type: 0 },
      artifact: { key: 'job-new', ext: 'webp' },
      url: 'https://host/a.webp',
      createdAt: 1_000,
    };
    await putPhotoRecord(db, record);
    // A stale job for the same file must not delete the card a newer job produced.
    await deletePhotoRecordIfOwned(db, 'sha-a', 'job-old');
    assert.deepEqual(await readPhotoRecord(db, 'sha-a'), record);
    await deletePhotoRecordIfOwned(db, 'sha-a', 'job-new');
    assert.equal(await readPhotoRecord(db, 'sha-a'), null);
  } finally {
    db.close();
  }
});

test('photo records read back in upload order, not hash order', async () => {
  const db = await freshDb();
  try {
    for (const [sha, createdAt] of [
      ['ff-zulu', 3_000],
      ['00-alpha', 1_000],
      ['55-mike', 2_000],
    ] as const) {
      await putPhotoRecord(db, {
        sha256: sha,
        status: 'hosted',
        createdAt,
        meta: { width: 1, height: 1, size: 1, type: 0 },
        url: `https://host/${sha}.webp`,
      });
    }
    assert.deepEqual(
      (await readPhotoRecords(db)).map((record) => record.createdAt),
      [1_000, 2_000, 3_000],
    );
  } finally {
    db.close();
  }
});
