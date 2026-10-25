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
  rebuildCache,
  removePhoto,
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
    await removePhoto(db, 'sha-a');
    assert.equal(await readPhotoRecord(db, 'sha-a'), null);
    // An upload op carries its sha in the payload, never as `targetSha`.
    const label = (o: Op): unknown =>
      o.targetSha ?? (o.payload as { sha256?: string } | null)?.sha256 ?? o.target;
    assert.deepEqual(
      (await readOps(db)).map((e) => label(e.op)),
      [7, 'sha-b'],
    );
    // Withdrawing something already gone is a no-op.
    await removePhoto(db, 'sha-a');
    assert.equal(await countOps(db), 2);
  } finally {
    db.close();
  }
});
