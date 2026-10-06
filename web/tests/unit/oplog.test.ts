import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Op } from '$shared/types';
import {
  appendOp,
  clearOps,
  countOps,
  isKnownAlbumSha,
  openOplogDb,
  readOps,
  rebuildCache,
  removeOpsBySha,
} from '../../src/core/oplog';

const op = (i: number) => ({ type: 'like' as const, target: i, payload: null });
const photo = (id: number) => ({ id, sha256: `sha-${id}` }) as never;

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

    // The snapshot is the only authority: a rebuild both adds and drops hashes.
    await rebuildCache(db, [photo(1), photo(2)]);
    assert.equal(await isKnownAlbumSha(db, 'sha-1'), true);
    assert.equal(await isKnownAlbumSha(db, 'missing'), false);
    await rebuildCache(db, [photo(2)]);
    assert.equal(await isKnownAlbumSha(db, 'sha-1'), false);
    assert.equal(await isKnownAlbumSha(db, 'sha-2'), true);
  } finally {
    db.close();
  }
});

test('removeOpsBySha withdraws every op addressed to one sha and nothing else', async () => {
  const db = await freshDb();
  try {
    const shaOp = (type: Op['type'], sha: string): Op => ({ type, targetSha: sha, payload: null });
    await appendOp(db, shaOp('upload', 'sha-a'));
    await appendOp(db, shaOp('like', 'sha-a'));
    await appendOp(db, shaOp('upload', 'sha-b'));
    await appendOp(db, op(7)); // announcement-addressed, carries no sha

    assert.equal(await removeOpsBySha(db, 'sha-a'), 2);
    assert.equal(await countOps(db), 2);
    assert.deepEqual(
      (await readOps(db)).map((e) => e.op.targetSha ?? e.op.target),
      ['sha-b', 7],
    );
    // Withdrawing an absent sha is a counted no-op.
    assert.equal(await removeOpsBySha(db, 'sha-a'), 0);
  } finally {
    db.close();
  }
});
