// The album write path, directly: what the /ws Durable Object runs per sync frame.
// These cases carry the invariants the old HTTP route tests asserted — idempotent
// uploads, the one-choice mark rule, per-op timestamps, vote validation, root-only
// deletion, and a malformed op that never aborts its neighbours.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Op } from '../shared/types.ts';
import { applyOps, snapshot, type OpsEnv } from './album-ops.ts';
import { countingDb } from '../testing/app.ts';
import { openLocalDb, type LocalDb } from '../testing/localDb.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');

function makeDb(): LocalDb {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  return db;
}

const env = (db: LocalDb, mediaHostUrl = 'https://facade.test'): OpsEnv => ({ db, mediaHostUrl });

const upload = (sha: string, over: Partial<Op> = {}): Op => ({
  type: 'upload',
  payload: {
    sha256: sha,
    url: `https://facade.test/${sha}.webp`,
    width: 1,
    height: 1,
    size: 2,
    type: 0,
    createdAt: 1_700_000_000_000,
  },
  ...over,
});

const fb = (contentMd: string, ts?: number): Op => ({
  type: 'fb_create',
  payload: { contentMd, locale: 'en-US' },
  ...(ts === undefined ? {} : { ts }),
});

async function seedPhoto(db: LocalDb, sha: string): Promise<void> {
  await applyOps(env(db), { id: 1 }, [upload(sha)], 1_000);
}

test('album-ops: an upload lands once, and a re-sent batch stays silent', async () => {
  const db = makeDb();
  await applyOps(env(db), { id: 1 }, [upload('aa')], 1_000);
  await applyOps(env(db), { id: 1 }, [upload('aa')], 2_000);
  const snap = await snapshot(db, 1);
  assert.equal(snap.photos.length, 1);
  assert.equal(snap.photos[0]!.uploader, 1);
});

test('album-ops: a future client timestamp is clamped to the server clock', async () => {
  const db = makeDb();
  const now = 1_900_000_000_000;
  const future = now + 3_600_000;
  await applyOps(
    env(db),
    { id: 1 },
    [
      upload('aa', {
        ts: future,
        payload: {
          sha256: 'aa',
          url: 'https://facade.test/a.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: future,
        },
      }),
    ],
    now,
  );
  const snap = await snapshot(db, 1);
  assert.equal(snap.photos[0]!.createdAt, now, 'a skewed clock cannot pin a photo into the future');
});

test("album-ops: feedback lands with the op's own commit time", async () => {
  const db = makeDb();
  const now = 1_900_000_000_000;
  const earlier = now - 60_000;
  // The offline case: one suggestion written an hour before the socket came back, one
  // written after. They must not share the arrival timestamp.
  await applyOps(env(db), { id: 0 }, [fb('earlier', earlier), fb('at-arrival')], now);
  const snap = await snapshot(db, 0);
  const byContent = new Map(snap.feedback.map((f) => [f.contentMd, f.createdAt]));
  assert.equal(byContent.get('earlier'), earlier);
  assert.equal(byContent.get('at-arrival'), now);
});

test('album-ops: a like and a dislike are one choice', async () => {
  const db = makeDb();
  await seedPhoto(db, 'aa');
  await applyOps(env(db), { id: 7 }, [{ type: 'like', targetSha: 'aa' }], 1_000);
  let snap = await snapshot(db, 1);
  assert.deepEqual(snap.photos[0]!.likes, [7]);
  await applyOps(env(db), { id: 7 }, [{ type: 'dislike', targetSha: 'aa' }], 1_100);
  snap = await snapshot(db, 1);
  assert.deepEqual(snap.photos[0]!.likes, [], 'the switch clears the opposite column');
  assert.deepEqual(snap.photos[0]!.dislikes, [7]);
  await applyOps(env(db), { id: 7 }, [{ type: 'unlike', targetSha: 'aa' }], 1_200);
  snap = await snapshot(db, 1);
  assert.deepEqual(snap.photos[0]!.dislikes, [7], 'unlike never touches the other column');
});

test('album-ops: a report stands alone beside a like', async () => {
  const db = makeDb();
  await seedPhoto(db, 'aa');
  await applyOps(
    env(db),
    { id: 7 },
    [
      { type: 'like', targetSha: 'aa' },
      { type: 'report', targetSha: 'aa' },
    ],
    1_000,
  );
  const snap = await snapshot(db, 1);
  assert.deepEqual(snap.photos[0]!.likes, [7]);
  assert.deepEqual(snap.photos[0]!.reports, [7]);
});

test('album-ops: delete is root-only', async () => {
  const db = makeDb();
  await seedPhoto(db, 'aa');
  await applyOps(env(db), { id: 9 }, [{ type: 'delete', targetSha: 'aa' }], 1_000);
  assert.equal((await snapshot(db, 1)).photos.length, 1, 'a non-root delete writes nothing');
  await applyOps(env(db), { id: 0 }, [{ type: 'delete', targetSha: 'aa' }], 1_100);
  assert.equal((await snapshot(db, 1)).photos.length, 0);
});

test('album-ops: votes validate against the poll definition', async () => {
  const db = makeDb();
  db.exec(
    `INSERT INTO polls (id, options, allow_multiple, locale, sort, updated_at)
     VALUES (1, '["A","B","C"]', 0, 'en-US', 0, 1),
            (2, '["X","Y"]', 1, 'en-US', 1, 1);`,
  );
  // Out of range: dropped.
  await applyOps(
    env(db),
    { id: 3 },
    [{ type: 'vote', target: 1, payload: { options: [5] } }],
    1_000,
  );
  // Two choices on a single-choice poll: dropped.
  await applyOps(
    env(db),
    { id: 3 },
    [{ type: 'vote', target: 1, payload: { options: [0, 1] } }],
    1_100,
  );
  assert.equal((await snapshot(db, 1)).polls[0]!.votes.length, 0);
  // A valid single choice replaces in full.
  await applyOps(
    env(db),
    { id: 3 },
    [{ type: 'vote', target: 1, payload: { options: [1] } }],
    1_200,
  );
  // A multi-choice poll accepts several.
  await applyOps(
    env(db),
    { id: 3 },
    [{ type: 'vote', target: 2, payload: { options: [0, 1] } }],
    1_300,
  );
  const snap = await snapshot(db, 1);
  assert.deepEqual(snap.polls[0]!.votes, [{ userId: 3, option: 1 }]);
  assert.deepEqual(snap.polls[1]!.votes, [
    { userId: 3, option: 0 },
    { userId: 3, option: 1 },
  ]);
});

test('album-ops: a malformed op never aborts its neighbours', async () => {
  const db = makeDb();
  await seedPhoto(db, 'aa');
  await applyOps(
    env(db),
    { id: 7 },
    [
      // An upload without a URL contributes nothing.
      {
        type: 'upload',
        payload: { sha256: 'bb', width: 1, height: 1, size: 2, type: 0, createdAt: 1 },
      },
      { type: 'like', targetSha: 'aa' },
    ],
    1_000,
  );
  const snap = await snapshot(db, 1);
  assert.equal(snap.photos.length, 1, 'the malformed op wrote nothing');
  assert.deepEqual(snap.photos[0]!.likes, [7], 'and its neighbour still applied');
});

test('album-ops: an unknown op type writes nothing and throws nothing', async () => {
  const db = makeDb();
  await applyOps(env(db), { id: 1 }, [{ type: 'time_travel' } as unknown as Op], 1_000);
  assert.equal((await snapshot(db, 1)).photos.length, 0);
});

test('album-ops: an upload URL outside the configured facade is refused', async () => {
  const db = makeDb();
  const stranger: Op = {
    type: 'upload',
    payload: {
      sha256: 'aa',
      // The storage rule is scheme-level: plain http off loopback is never storable.
      url: 'http://evil.test/a.webp',
      width: 1,
      height: 1,
      size: 2,
      type: 0,
      createdAt: 1,
    },
  };
  await applyOps(env(db), { id: 1 }, [stranger], 1_000);
  assert.equal((await snapshot(db, 1)).photos.length, 0);
  // The dev exception: a loopback-configured facade accepts its own loopback URLs.
  const local = env(db, 'http://127.0.0.1:8788');
  await applyOps(
    local,
    { id: 1 },
    [
      {
        type: 'upload',
        payload: {
          sha256: 'bb',
          url: 'http://127.0.0.1:8788/b.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1,
        },
      },
    ],
    1_000,
  );
  assert.equal((await snapshot(db, 1)).photos.length, 1);
});

test('album-ops: a reaction needs an existing announcement', async () => {
  const db = makeDb();
  await applyOps(
    env(db),
    { id: 7 },
    [{ type: 'react', target: 99, payload: { emoji: '🔥' } }],
    1_000,
  );
  assert.equal((await snapshot(db, 1)).announcements.length, 0);
  db.exec(
    "INSERT INTO announcements (id, title, content_md, locale, sort, updated_at) VALUES (5, 't', 'md', 'en-US', 0, 1);",
  );
  await applyOps(
    env(db),
    { id: 7 },
    [{ type: 'react', target: 5, payload: { emoji: '🔥' } }],
    1_100,
  );
  const snap = await snapshot(db, 1);
  assert.deepEqual(snap.announcements[0]!.reactions, [{ userId: 7, emoji: '🔥' }]);
  // An empty emoji clears the row instead of inserting.
  await applyOps(env(db), { id: 7 }, [{ type: 'react', target: 5, payload: { emoji: '' } }], 1_200);
  assert.deepEqual((await snapshot(db, 1)).announcements[0]!.reactions, []);
});

test("album-ops: a batch's writes cost a fixed handful of round trips, not one per op", async () => {
  const raw = makeDb();
  const counts = { queries: 0, batches: 0, maxBinds: 0 };
  const { db } = countingDb(raw, counts);
  // 100 mark ops = 100 statements = 2 batches at MAX_BATCH_STATEMENTS = 100, plus the
  // reads before any write. What it must never be is one round trip per op.
  const ops: Op[] = [];
  await applyOps({ db, mediaHostUrl: 'https://facade.test' }, { id: 0 }, [upload('aa')], 1_000);
  for (let i = 0; i < 100; i++) ops.push({ type: 'like', targetSha: 'aa' });
  counts.batches = 0;
  await applyOps({ db, mediaHostUrl: 'https://facade.test' }, { id: 0 }, ops, 1_100);
  assert.ok(counts.batches <= 3, `100 statements landed in ${counts.batches} batches`);
  assert.ok(counts.maxBinds <= 100, `a statement bound ${counts.maxBinds} params (D1 caps 100)`);
});

test('album-ops: the snapshot groups rows and gates feedback to root', async () => {
  const db = makeDb();
  db.exec(
    `INSERT INTO announcements (id, title, content_md, locale, sort, updated_at)
     VALUES (5, 't', 'md', 'en-US', 0, 1);`,
  );
  await applyOps(env(db), { id: 7 }, [fb('note')], 1_000);
  await applyOps(
    env(db),
    { id: 7 },
    [{ type: 'react', target: 5, payload: { emoji: '🔥' } }],
    1_100,
  );
  const forRoot = await snapshot(db, 0);
  assert.equal(forRoot.feedback.length, 1, 'root sees the suggestion');
  const forGuest = await snapshot(db, 1);
  assert.equal(forGuest.feedback.length, 0, 'nobody else does');
  assert.deepEqual(forGuest.announcements[0]!.reactions, [{ userId: 7, emoji: '🔥' }]);
});
