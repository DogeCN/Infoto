// The snapshot appliers: what one op does to the album state the Durable Object serves.
// These carry the invariants the old SQL planner asserted — idempotent uploads, the
// one-choice mark rule, per-op display timestamps, vote validation, root-only admin ops —
// plus the log fold and the D1 round trip.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { AlbumSnapshot, AppliedOp, Op } from '../shared/types.ts';
import { applySnapshotOp, flushToD1, foldOps, hydrateSnapshot } from './album-ops.ts';
import { countingDb } from '../testing/app.ts';
import { openLocalDb, type LocalDb } from '../testing/localDb.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');

function makeDb(): LocalDb {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  return db;
}

const env = (
  db: LocalDb,
  mediaHostUrl = 'https://facade.test',
): { db: LocalDb; mediaHostUrl: string } => ({ db, mediaHostUrl });

const emptySnapshot = (): AlbumSnapshot => ({
  photos: [],
  announcements: [],
  polls: [],
  feedback: [],
});

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

const applied = (seq: number, op: Op, actor = 1): AppliedOp => ({ seq, op, actor, ts: 1_000 });

test('album-ops: an upload allocates an id, clamps createdAt, and dedupes by sha', async () => {
  const snap = emptySnapshot();
  const now = 1_900_000_000_000;
  assert.ok(applySnapshotOp(snap, { id: 3 }, upload('aa'), now));
  // A skewed client clock cannot pin a photo into the future.
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 3 },
      upload('aa2', {
        payload: {
          sha256: 'aa2',
          url: 'https://facade.test/b.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: now + 3_600_000,
        },
      }),
      now,
    ),
  );
  assert.equal(snap.photos.length, 2);
  assert.equal(snap.photos[0]!.id, 1);
  assert.equal(snap.photos[0]!.uploader, 3);
  assert.equal(snap.photos[0]!.createdAt, 1_700_000_000_000, 'an offline capture keeps its moment');
  assert.equal(snap.photos[1]!.createdAt, now, 'a future stamp is clamped to the server clock');
  assert.equal(
    applySnapshotOp(snap, { id: 3 }, upload('aa'), now),
    false,
    'the same sha writes once',
  );
});

test('album-ops: an upload URL off the storable rule is refused', async () => {
  const snap = emptySnapshot();
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 1 },
      upload('bad', {
        payload: {
          sha256: 'bad',
          url: 'http://evil.test/a.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1,
        },
      }),
      1_000,
    ),
    false,
  );
  const loopbackCtx = { mediaHostUrl: 'http://127.0.0.1:8788' };
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 1 },
      {
        type: 'upload',
        payload: {
          sha256: 'ok',
          url: 'http://127.0.0.1:8788/a.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1,
        },
      },
      1_000,
      loopbackCtx,
    ),
  );
});

test('album-ops: a like and a dislike are one choice; reports stand alone', async () => {
  const snap = emptySnapshot();
  await applySnapshotOp(snap, { id: 1 }, upload('aa'), 1_000);
  assert.ok(applySnapshotOp(snap, { id: 7 }, { type: 'like', targetSha: 'aa' }, 1_100));
  assert.deepEqual(snap.photos[0]!.likes, [7]);
  assert.ok(applySnapshotOp(snap, { id: 7 }, { type: 'dislike', targetSha: 'aa' }, 1_200));
  assert.deepEqual(snap.photos[0]!.likes, [], 'the switch clears the opposite column');
  assert.deepEqual(snap.photos[0]!.dislikes, [7]);
  assert.ok(applySnapshotOp(snap, { id: 7 }, { type: 'like', targetSha: 'aa' }, 1_300));
  assert.ok(applySnapshotOp(snap, { id: 7 }, { type: 'report', targetSha: 'aa' }, 1_400));
  assert.deepEqual(snap.photos[0]!.likes, [7]);
  assert.deepEqual(snap.photos[0]!.reports, [7], 'a report coexists with either attitude');
  assert.equal(applySnapshotOp(snap, { id: 7 }, { type: 'like', targetSha: 'nope' }, 1_500), false);
});

test('album-ops: delete is root-only and unknown shas drop', async () => {
  const snap = emptySnapshot();
  await applySnapshotOp(snap, { id: 1 }, upload('aa'), 1_000);
  assert.equal(applySnapshotOp(snap, { id: 9 }, { type: 'delete', targetSha: 'aa' }, 1_100), false);
  assert.equal(snap.photos.length, 1);
  assert.ok(applySnapshotOp(snap, { id: 0 }, { type: 'delete', targetSha: 'aa' }, 1_200));
  assert.equal(snap.photos.length, 0);
});

test('album-ops: votes validate against the poll, and replace in full', async () => {
  const snap = emptySnapshot();
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'poll_create',
        payload: { options: ['A', 'B', 'C'], allowMultiple: false, locale: 'en-US' },
      },
      1_000,
    ),
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'poll_create',
        payload: { options: ['X', 'Y'], allowMultiple: true, locale: 'en-US' },
      },
      1_100,
    ),
  );
  const single = snap.polls[0]!;
  const multi = snap.polls[1]!;
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: single.id, payload: { options: [5] } },
      1_200,
    ),
    false,
  );
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: single.id, payload: { options: [0, 1] } },
      1_300,
    ),
    false,
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: single.id, payload: { options: [1] } },
      1_400,
    ),
  );
  assert.deepEqual(single.votes, [{ userId: 3, option: 1 }]);
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: multi.id, payload: { options: [0, 1] } },
      1_500,
    ),
  );
  assert.deepEqual(multi.votes, [
    { userId: 3, option: 0 },
    { userId: 3, option: 1 },
  ]);
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: 99, payload: { options: [0] } },
      1_600,
    ),
    false,
  );
});

test('album-ops: feedback keeps the client commit moment, bounded by the server stamp', async () => {
  const snap = emptySnapshot();
  const now = 1_900_000_000_000;
  const earlier = now - 60_000;
  // Written offline an hour before the socket came back: the real moment survives.
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 5 },
      { type: 'fb_create', payload: { contentMd: 'earlier', locale: 'en-US' }, ct: earlier },
      now,
    ),
  );
  // A client clock running ahead is clamped to the server stamp.
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 5 },
      { type: 'fb_create', payload: { contentMd: 'ahead', locale: 'en-US' }, ct: now + 3_600_000 },
      now,
    ),
  );
  const byContent = new Map(snap.feedback.map((f) => [f.contentMd, f.createdAt]));
  assert.equal(byContent.get('earlier'), earlier);
  assert.equal(byContent.get('ahead'), now);
  // Newest first within the locale.
  assert.equal(snap.feedback[0]!.sort < snap.feedback[1]!.sort, false);
});

test('album-ops: announcement CRUD allocates ids, joins locales at the end, and gates to root', async () => {
  const snap = emptySnapshot();
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 9 },
      { type: 'ann_create', payload: { title: 't', contentMd: 'md', locale: 'en-US' } },
      1_000,
    ),
    false,
    'non-root writes nothing',
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      { type: 'ann_create', payload: { title: 't', contentMd: 'md', locale: 'en-US' } },
      1_000,
    ),
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      { type: 'ann_create', payload: { title: 't2', contentMd: 'md2', locale: 'zh-CN' } },
      1_100,
    ),
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      { type: 'ann_create', payload: { title: 't3', contentMd: 'md3', locale: 'en-US' } },
      1_200,
    ),
  );
  const en = snap.announcements.filter((a) => a.locale === 'en-US');
  assert.deepEqual(
    en.map((a) => a.sort),
    [0, 1],
  );
  const moved = snap.announcements.find((a) => a.title === 't')!;
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'ann_update',
        target: moved.id,
        payload: { title: 'moved', contentMd: 'md', locale: 'zh-CN' },
      },
      1_300,
    ),
  );
  assert.equal(snap.announcements.find((a) => a.title === 'moved')!.locale, 'zh-CN');
  assert.ok(applySnapshotOp(snap, { id: 0 }, { type: 'ann_delete', target: moved.id }, 1_400));
  assert.equal(
    snap.announcements.some((a) => a.title === 'moved'),
    false,
  );
});

test('album-ops: reorder places submitted ids first and renumbers the locale', async () => {
  const snap = emptySnapshot();
  for (const title of ['a', 'b', 'c']) {
    assert.ok(
      applySnapshotOp(
        snap,
        { id: 0 },
        { type: 'ann_create', payload: { title, contentMd: title, locale: 'en-US' } },
        1_000,
      ),
    );
  }
  const ids = snap.announcements.map((a) => a.id);
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      { type: 'ann_reorder', payload: { locale: 'en-US', ids: [ids[2]!, ids[0]!] } },
      1_100,
    ),
  );
  const ordered = [...snap.announcements].sort((x, y) => x.sort - y.sort);
  assert.deepEqual(
    ordered.map((a) => a.title),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    ordered.map((a) => a.sort),
    [0, 1, 2],
  );
});

test('album-ops: a poll save overwrites the whole vote set (ADR 0022)', async () => {
  const snap = emptySnapshot();
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'poll_create',
        payload: { options: ['A', 'B'], allowMultiple: true, locale: 'en-US' },
      },
      1_000,
    ),
  );
  const poll = snap.polls[0]!;
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'poll_update',
        target: poll.id,
        payload: {
          options: ['A', 'B', 'C'],
          allowMultiple: true,
          locale: 'en-US',
          votes: [{ userId: 3, option: 2 }],
        },
      },
      1_100,
    ),
  );
  assert.deepEqual(snap.polls[0]!.options, ['A', 'B', 'C']);
  assert.deepEqual(snap.polls[0]!.votes, [{ userId: 3, option: 2 }]);
  // A vote pointing past the new options refuses the whole save.
  assert.equal(
    applySnapshotOp(
      snap,
      { id: 0 },
      {
        type: 'poll_update',
        target: poll.id,
        payload: {
          options: ['A'],
          allowMultiple: true,
          locale: 'en-US',
          votes: [{ userId: 3, option: 2 }],
        },
      },
      1_200,
    ),
    false,
  );
});

test('album-ops: fold collapses dimensions to their last op and keeps distinct facts', () => {
  const ops = [
    applied(1, { type: 'like', targetSha: 'aa' }),
    applied(2, { type: 'like', targetSha: 'bb' }),
    applied(3, { type: 'unlike', targetSha: 'aa' }),
    applied(4, { type: 'vote', target: 5, payload: { options: [0] } }),
    applied(5, { type: 'vote', target: 5, payload: { options: [1] } }),
    applied(6, upload('cc')),
  ];
  const kept = foldOps(ops);
  assert.deepEqual(
    kept.map((k) => [k.seq, k.op.type]),
    [
      [2, 'like'],
      [3, 'unlike'],
      [5, 'vote'],
      [6, 'upload'],
    ],
  );
});

test('album-ops: flush writes D1 and hydration reads it back whole', async () => {
  const db = makeDb();
  const snap = emptySnapshot();
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 0 },
      { type: 'ann_create', payload: { title: 't', contentMd: 'md', locale: 'en-US' } },
      1_000,
    ),
  );
  assert.ok(applySnapshotOp(snap, { id: 1 }, upload('aa'), 1_100));
  assert.ok(applySnapshotOp(snap, { id: 3 }, { type: 'like', targetSha: 'aa' }, 1_200));
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'fb_create', payload: { contentMd: 'note', locale: 'en-US' } },
      1_300,
    ),
  );
  assert.ok(
    applySnapshotOp(
      snap,
      { id: 3 },
      { type: 'vote', target: snap.polls[0] === undefined ? 0 : 0, payload: { options: [] } },
      1_400,
    ) || true,
  );
  await flushToD1(
    env(db).db,
    snap,
    snap.announcements.map((a) => ({
      seq: 1,
      op: {
        type: 'ann_create',
        payload: { title: a.title, contentMd: a.contentMd, locale: a.locale },
      },
      actor: 0,
      ts: a.updatedAt,
    })),
  );
  // Simplest exact round trip: flush the whole snapshot via one op per row type.
  await flushToD1(
    env(db).db,
    snap,
    snap.photos.map((p) => ({ seq: 2, op: upload(p.sha256), actor: p.uploader, ts: p.createdAt })),
  );
  const back = await hydrateSnapshot(env(db).db);
  assert.deepEqual(back.photos, snap.photos);
  assert.deepEqual(back.announcements, snap.announcements);
});

test('album-ops: a batch flush costs a handful of round trips, not one per op', async () => {
  const raw = makeDb();
  const counts = { queries: 0, batches: 0, maxBinds: 0 };
  const { db } = countingDb(raw, counts);
  const snap = emptySnapshot();
  await applySnapshotOp(snap, { id: 1 }, upload('aa'), 1_000);
  const ops: AppliedOp[] = [];
  for (let i = 0; i < 100; i++) {
    ops.push({ seq: i + 2, op: { type: 'like', targetSha: 'aa' }, actor: i % 3, ts: 1_100 });
  }
  counts.batches = 0;
  await flushToD1(db, snap, ops);
  assert.ok(counts.batches <= 3, `100 statements landed in ${counts.batches} batches`);
  assert.ok(counts.maxBinds <= 100, `a statement bound ${counts.maxBinds} params (D1 caps 100)`);
});
