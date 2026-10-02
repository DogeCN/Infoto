import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  appendOp,
  clearOps,
  countOps,
  isKnownAlbumSha,
  openOplogDb,
  readOps,
  rebuildCache,
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
