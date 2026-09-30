import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  appendOp,
  clearOps,
  countOps,
  lookupSha,
  openOplogDb,
  putSha,
  readOps,
} from '../../src/core/oplog';

const op = (i: number) => ({ type: 'like' as const, target: i, payload: null });

async function freshDb(): Promise<IDBDatabase> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('infoto');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  return openOplogDb();
}

describe('oplog', () => {
  it('appends, clears, and keeps sha lookups scoped to a purpose', async () => {
    const db = await freshDb();
    try {
      expect(await countOps(db)).toBe(0);
      await appendOp(db, op(1));
      await appendOp(db, op(2));
      expect(await countOps(db)).toBe(2);
      expect((await readOps(db)).map((e) => e.op.target as number)).toEqual([1, 2]);
      await clearOps(db);
      expect(await countOps(db)).toBe(0);

      await putSha(db, 'album', 'abc', 42);
      expect(await lookupSha(db, 'album', 'abc')).toMatchObject({
        sha256: 'abc',
        purpose: 'album',
        photoId: 42,
      });
      expect(await lookupSha(db, 'album', 'missing')).toBeUndefined();
      await putSha(db, 'editor', 'def', null, 'https://cdn.example/x.png');
      expect(await lookupSha(db, 'editor', 'def')).toMatchObject({
        purpose: 'editor',
        photoId: null,
        url: 'https://cdn.example/x.png',
      });
      expect(await lookupSha(db, 'album', 'def')).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
