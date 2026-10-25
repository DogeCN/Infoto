// One photo record, end to end. The regression this guards: a batch whose /sync timed out left
// the photos hosted and invisible, because the card showing them lived in the upload store's
// memory. The record is the durable half — the worker writes `uploading`, the page turns it into
// `hosted` in the same transaction that appends the upload op, and only a confirmed sync retires
// it.
//
// These cases drive the real stores through the engine, so they cover the seam a pure projection
// cannot: what a reload actually reads. They do NOT cover the page store's own projection
// (`refreshHostedPhotos`, temp ids, the in-memory mark map) — that layer needs a component
// context, and `uploadPreview.test.ts` guards its wiring from source instead.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Photo, SyncResponse, UploadPayload } from '$shared/types';
import { buildUploadOp } from '../../src/base/upload/pipeline';
import { SyncEngine } from '../../src/core/engine';
import {
  appendUpload,
  clearOps,
  openOplogDb,
  putPhotoRecord,
  readOps,
  readPhotoRecord,
  readPhotoRecords,
  removePhotos,
  type PhotoRecord,
} from '../../src/core/oplog';
import { hostedPhotoCards, type HostedPhotoFields } from '../../src/core/pending';

let db: IDBDatabase;

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('infoto');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
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

/** What the page writes when an upload finishes: the op and the record, one transaction. */
const hosted = (sha: string): Promise<IDBValidKey> =>
  appendUpload(db, buildUploadOp(payload(sha)), {
    sha256: sha,
    status: 'uploading',
    meta: { width: 800, height: 600, size: 100, type: 0 },
    artifact: { key: `job-${sha}`, ext: 'webp' },
    url: `https://host/${sha}.webp`,
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

/** The page's own read: records in, cards out. */
const cards = async (
  engine: SyncEngine,
  landed = new Set<string>(),
): Promise<HostedPhotoFields[]> =>
  hostedPhotoCards(await engine.hostedPhotos(), { landed, live: new Set() });

const logged = async (): Promise<number> => (await readOps(db)).length;

test('a hosted photo still reads as a card after a failed sync', async () => {
  await hosted('a');
  await hosted('b');

  const engine = new SyncEngine({
    db,
    // The failure the report saw: the request never comes back in time.
    postSyncFn: () => Promise.reject(new Error('sync_timeout')),
  });
  const attempt = await engine.sync();
  assert.equal(attempt.ok, false);
  assert.equal(attempt.confirmedThroughVersion, 0, 'nothing was confirmed');

  // Both halves of the pair survive a failed attempt: the ops the server never applied, and the
  // records the page draws from.
  assert.equal(await logged(), 2);
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

test('a confirmed sync retires both the ops and the records', async () => {
  await hosted('a');
  await hosted('b');

  const engine = new SyncEngine({
    db,
    postSyncFn: () =>
      Promise.resolve({ response: snapshot([photo(1, 'a'), photo(2, 'b')]), status: 200 }),
  });
  await engine.sync();

  assert.equal(await logged(), 0, 'confirmed keys are cleared');
  assert.deepEqual(await readPhotoRecords(db), [], 'and their records go with them');
  assert.deepEqual(await cards(engine), [], 'so there is no card left to draw');
});

test('a withdrawn photo leaves nothing behind', async () => {
  await hosted('a');
  await hosted('b');
  const engine = new SyncEngine({ db });

  // The upload op is deleted by its own key — the record is what knows that key.
  await removePhotos(db, ['a']);
  assert.equal(await readPhotoRecord(db, 'a'), null);
  assert.equal(await logged(), 1, 'only the other photo op is left');
  assert.deepEqual(
    (await cards(engine)).map((fields) => fields.sha256),
    ['b'],
  );
});

test('a landed or live sha never draws a second card', async () => {
  await hosted('a');
  await hosted('b');
  const engine = new SyncEngine({ db });
  const records = await engine.hostedPhotos();

  // A partial batch: the snapshot can carry one sha while the other one is still queued.
  assert.deepEqual(
    hostedPhotoCards(records, { landed: new Set(['a']), live: new Set() }).map((f) => f.sha256),
    ['b'],
  );
  // A live job owns the card for its own sha.
  assert.deepEqual(
    hostedPhotoCards(records, { landed: new Set(), live: new Set(['a']) }).map((f) => f.sha256),
    ['b'],
  );
});

test('a late mark write cannot resurrect a withdrawn photo', async () => {
  await hosted('a');
  const engine = new SyncEngine({ db });
  await removePhotos(db, ['a']);
  // The record is gone, so the write is a no-op rather than a half-resurrected card.
  await engine.updatePhotoMarks('a', { likes: [0], dislikes: [], reports: [] });
  assert.equal(await readPhotoRecord(db, 'a'), null);
  assert.deepEqual(await cards(engine), []);
});

test('a worker-owned record is not a card: the worker replays it as a job', async () => {
  const engine = new SyncEngine({ db });
  const workerRecord = (sha: string, status: PhotoRecord['status']): PhotoRecord => ({
    sha256: sha,
    status,
    meta: { width: 4, height: 3, size: 10, type: 0 },
    artifact: { key: `job-${sha}`, ext: 'webp' },
  });
  await putPhotoRecord(db, workerRecord('a', 'uploading'));
  await putPhotoRecord(db, workerRecord('b', 'failed'));
  assert.deepEqual(await cards(engine), []);
});

// The withdrawal cannot remove the tombstone's future, and the tombstone must not swallow the
// photo the user puts back: an upload after a withdrawal is a new record and a new card.
test('re-picking a deleted file puts its card back', async () => {
  await hosted('a');
  const engine = new SyncEngine({ db });
  await removePhotos(db, ['a']);
  assert.deepEqual(await cards(engine), [], 'the withdrawal took the card');

  await hosted('a');
  assert.deepEqual(
    (await cards(engine)).map((fields) => fields.sha256),
    ['a'],
    'a later upload of the same sha revives it',
  );
});
