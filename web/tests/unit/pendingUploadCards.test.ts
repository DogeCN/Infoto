// The regression behind this file: a 200-photo upload whose /sync timed out left 200
// unconfirmed `upload` ops in the oplog and *nothing on screen*, because the card showing them
// lived in the upload store's memory and the SharedWorker deletes its resume record the moment
// the upload succeeds. The op is the durable record of a photo that is hosted and paid for —
// so it must read as a card after the page that created it is gone, and it must disappear the
// moment a sync confirms it.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Op, Photo, SyncResponse, UploadPayload } from '$shared/types';
import { buildUploadOp } from '../../src/base/upload/pipeline';
import { SyncEngine } from '../../src/core/engine';
import { appendOp, clearOps, openOplogDb, readOps } from '../../src/core/oplog';
import { queuedUploadCards, type QueuedUploadFields } from '../../src/core/pending';

let db: IDBDatabase;

beforeEach(async () => {
  db = await openOplogDb();
  await clearOps(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // a case may have closed the connection itself
  }
});

const payload = (sha: string): UploadPayload => ({
  sha256: sha,
  url: `https://host/${sha}.webp`,
  width: 800,
  height: 600,
  size: 100,
  type: 0,
  createdAt: 1_700_000_000_000,
});

const photo = (id: number, sha: string): Photo => ({
  id,
  sha256: sha,
  url: `https://host/${sha}.webp`,
  uploader: 0,
  width: 800,
  height: 600,
  size: 100,
  createdAt: 1_700_000_000_000,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
});

const snapshot = (photos: Photo[] = []): SyncResponse => ({
  ok: true,
  serverTime: 1_700_000_000_000,
  selfId: 0,
  mediaHostUrl: 'https://facade.test',
  photos,
  announcements: [],
  polls: [],
  feedback: [],
});

/** The op-log path the upload store runs at page open: read, then project. */
const cards = async (
  engine: SyncEngine,
  landed = new Set<string>(),
): Promise<QueuedUploadFields[]> =>
  queuedUploadCards(await engine.queuedOps(), { landed, live: new Set() });

const logged = async (): Promise<Op[]> => (await readOps(db)).map((entry) => entry.op);

test('queued upload cards: an unconfirmed batch still reads as cards after a failed sync', async () => {
  await appendOp(db, buildUploadOp(payload('a')));
  await appendOp(db, buildUploadOp(payload('b')));
  await appendOp(db, { type: 'like', targetSha: 'a' });

  const engine = new SyncEngine({
    db,
    // The failure the user saw: the request never comes back in time.
    postSyncFn: () => Promise.reject(new Error('sync_timeout')),
  });
  const attempt = await engine.sync();
  assert.equal(attempt.ok, false);
  assert.equal(attempt.confirmedThroughVersion, 0, 'nothing was confirmed');

  // The log is untouched by a failed attempt, so the page still shows the photos it holds.
  assert.equal((await logged()).length, 3);
  const projected = await cards(engine);
  assert.deepEqual(
    projected.map((fields) => fields.sha256),
    ['a', 'b'],
  );
  assert.deepEqual(
    projected.map((fields) => fields.url),
    ['https://host/a.webp', 'https://host/b.webp'],
  );
  assert.equal(projected[0]!.createdAt, 1_700_000_000_000, 'the upload instant survives');
});

test('queued upload cards: a confirmed sync retires the cards', async () => {
  await appendOp(db, buildUploadOp(payload('a')));
  await appendOp(db, buildUploadOp(payload('b')));

  const engine = new SyncEngine({
    db,
    postSyncFn: () =>
      Promise.resolve({ response: snapshot([photo(1, 'a'), photo(2, 'b')]), status: 200 }),
  });
  await engine.sync();

  assert.deepEqual(await logged(), [], 'confirmed keys are cleared');
  assert.deepEqual(await cards(engine), [], 'so there is no card left to draw');
});

test('queued upload cards: a landed or live sha never draws a second card', async () => {
  await appendOp(db, buildUploadOp(payload('a')));
  await appendOp(db, buildUploadOp(payload('b')));
  const engine = new SyncEngine({ db });
  const ops = await engine.queuedOps();

  // A partial batch: the snapshot can carry one sha while the other one's op is still queued.
  assert.deepEqual(
    queuedUploadCards(ops, { landed: new Set(['a']), live: new Set() }).map((f) => f.sha256),
    ['b'],
  );
  // A live job owns the card for its own sha.
  assert.deepEqual(
    queuedUploadCards(ops, { landed: new Set(), live: new Set(['a']) }).map((f) => f.sha256),
    ['b'],
  );
});

// The withdrawal of a pending photo cannot remove its upload op (`removeOpsBySha` matches
// `targetSha` and an upload op carries none), so the tombstone it files is the only durable
// record that the photo is gone. Without honouring it, deleting a card and reloading before the
// next sync brought the photo back — the card, the hosted bytes and the op disagreeing.
test('queued upload cards: a deleted photo stays deleted across a reload', async () => {
  await appendOp(db, buildUploadOp(payload('a')));
  await appendOp(db, { type: 'delete', targetSha: 'a' });
  const engine = new SyncEngine({ db });
  assert.deepEqual(await cards(engine), [], 'the queued tombstone withdraws the card');
});

test('queued upload cards: re-picking a deleted file draws its new card', async () => {
  await appendOp(db, buildUploadOp(payload('a')));
  await appendOp(db, { type: 'delete', targetSha: 'a' });
  await appendOp(db, buildUploadOp({ ...payload('a'), url: 'https://host/a-again.webp' }));
  const engine = new SyncEngine({ db });
  const projected = await cards(engine);
  assert.deepEqual(
    projected.map((fields) => fields.sha256),
    ['a'],
  );
  assert.equal(projected[0]!.url, 'https://host/a-again.webp', 'the newest upload describes it');
});
