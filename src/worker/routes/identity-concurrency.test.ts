import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createUser } from '../identity.ts';
import { makeApp } from '../../testing/app.ts';

/**
 * Simultaneous first visits must not collide on the users primary key.
 *
 * `users.id` is derived from MAX(id) rather than AUTOINCREMENT, so the id has to be
 * computed somewhere. Computing it by reading first leaves a read-then-write window: two
 * visitors reading the same maximum both insert it. The previous implementation caught
 * that violation and retried three times, which covered two or three racers and threw on
 * the fourth — measured, not assumed. The id is now computed inside the INSERT so SQLite
 * serializes the whole statement and there is no window to fall into.
 *
 * The old shape fails this test at 8 racers, so it cannot regress silently.
 */
test('concurrent first visits each get their own id', async () => {
  const RACERS = 8;
  const { db } = makeApp();

  const rows = await Promise.all(Array.from({ length: RACERS }, () => createUser(db)));

  const ids = rows.map((r) => r.id).sort((a, b) => a - b);
  assert.equal(new Set(ids).size, RACERS, 'ids must be distinct');
  // The first visitor gets 0, so a fresh table yields a contiguous 0..N-1 range.
  assert.deepEqual(
    ids,
    Array.from({ length: RACERS }, (_, i) => i),
  );

  const stored = await db.prepare('SELECT id FROM users ORDER BY id').all<{ id: number }>();
  assert.equal(stored.results.length, RACERS);
  assert.deepEqual(
    stored.results.map((r) => r.id),
    ids,
  );

  // Every identity is distinct, so one visitor's cookie never resolves to another's album.
  const uuids = rows.map((r) => r.uuid);
  assert.equal(new Set(uuids).size, RACERS);
});

/** The uuid round-trip must hold for a caller that only knows the cookie value. */
test('each concurrent identity resolves back to itself', async () => {
  const { db } = makeApp();
  const rows = await Promise.all(Array.from({ length: 4 }, () => createUser(db)));
  for (const row of rows) {
    const found = await db
      .prepare('SELECT id FROM users WHERE uuid = ?')
      .bind(row.uuid)
      .first<number>('id');
    assert.equal(found, row.id);
  }
});
