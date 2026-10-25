// One photo record, end to end: the pure projection, the durable record, the page's read of
// it, and the source-level wiring of the upload store that no unit test can reach.
//
// The regression these guard: a batch whose /sync timed out left the photos hosted and
// invisible, because the card showing them lived in the upload store's memory. The record is
// the durable half — the worker writes `uploading`, the page turns it into `hosted` in the
// same transaction that appends the upload op, and only a confirmed sync retires it.
//
// `createUploadStore` pulls in the SharedWorker bundle, so the store's own read
// (`refreshHostedPhotos`, temp ids, the in-memory mark map) is guarded from source at the end
// of this file rather than driven; everything else drives the real stores through the engine.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Photo, SyncResponse, UploadPayload } from '$shared/types';
import { buildUploadOp } from '../../src/base/upload/pipeline';
import { SyncEngine } from '../../src/core/engine';
import { EMPTY_MARKS } from '../../src/core/ops';
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
import {
  hostedPhotoCards,
  pendingMediaUrl,
  pendingPhoto,
  rendersCard,
  sameHostedCards,
  samePendingPhoto,
  type HostedPhotoFields,
  type PendingPhotoFields,
} from '../../src/core/pending';

// The app store pulls in svelte-sonner for its toasts, whose own dependency has no node export
// condition; the store's op handling does not touch it.
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const { createAppStore, setPendingUploadCancelSink } =
  await import('../../src/state/appStore.svelte');

const store = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'state', 'uploadStore.svelte.ts'),
  'utf8',
);

// ---- the pure projection ------------------------------------------------------------------

const fields = (over: Partial<PendingPhotoFields> = {}): PendingPhotoFields => ({
  id: -1,
  sha256: 'sha',
  url: 'https://host/a.webp',
  uploader: 7,
  width: 800,
  height: 600,
  size: 100,
  type: 0,
  createdAt: 1_000,
  marks: EMPTY_MARKS,
  ...over,
});

test('pending photo: projects the card and keeps identity while its fields hold', () => {
  const input = fields();
  const photo = pendingPhoto(input);
  assert.deepEqual(photo, {
    id: -1,
    sha256: 'sha',
    url: 'https://host/a.webp',
    uploader: 7,
    width: 800,
    height: 600,
    size: 100,
    createdAt: 1_000,
    type: 0,
    likes: [],
    dislikes: [],
    reports: [],
  });

  assert.equal(samePendingPhoto(photo, input), true);
  assert.equal(samePendingPhoto(undefined, input), false);
  assert.equal(samePendingPhoto(photo, fields({ width: 801 })), false);
  assert.equal(samePendingPhoto(photo, fields({ url: 'https://host/b.webp' })), false);

  // Mark arrays are a reference comparison: a new set is a change even when it is equal.
  assert.equal(
    samePendingPhoto(photo, fields({ marks: { likes: [], dislikes: [], reports: [] } })),
    false,
  );
});

// The upload-complete handoff: the card keeps the already-decoded local preview until the
// hosted copy has actually loaded in this page. Swapping `src` first is what showed a
// skeleton over a photo the user could already see.
test('pending media url: the local preview holds until the hosted copy is renderable', () => {
  const hosted = 'https://cdn.test/a.webp';
  const local = 'blob:http://localhost/abc';

  assert.equal(pendingMediaUrl(hosted, local, 'pending'), local);
  assert.equal(pendingMediaUrl(hosted, local, 'ready'), hosted);
  // A failed hosted load falls through so the card can report the failure.
  assert.equal(pendingMediaUrl(hosted, local, 'failed'), hosted);
  // Before the upload finishes there is no hosted URL at all.
  assert.equal(pendingMediaUrl('', local, undefined), local);
  // No local preview (another tab, or the artifact read failed): use the hosted URL.
  assert.equal(pendingMediaUrl(hosted, '', 'pending'), hosted);
  assert.equal(pendingMediaUrl('', '', undefined), '');
});

test('pending card: a transcode failure renders no card, an upload failure does', () => {
  // A transcode failure has no artifact and no surviving source; its only report is the toast.
  assert.equal(rendersCard({ phase: 'failed' }), false);
  assert.equal(rendersCard({ phase: 'failed', url: undefined, meta: undefined }), false);
  // Reaching the upload leg is what proves an artifact exists on disk.
  assert.equal(
    rendersCard({ phase: 'failed', meta: { width: 1, height: 1, size: 1, type: 0 } }),
    true,
  );
  assert.equal(rendersCard({ phase: 'failed', url: 'https://host/a.webp' }), true);
  // The stages that always render one.
  assert.equal(rendersCard({ phase: 'uploading', meta: {} }), true);
  assert.equal(rendersCard({ phase: 'done' }), true);
  // Stages that never do: panel rows and in-flight work.
  for (const phase of ['queued', 'lease-wait', 'transcoding', 'hashing', 'duplicate']) {
    assert.equal(rendersCard({ phase }), false, phase);
  }
});

/** A `hosted` photo record: the client's own word about a photo the album does not have yet. */
const hostedRecord = (over: Partial<PhotoRecord> = {}): PhotoRecord => ({
  sha256: 'sha-a',
  status: 'hosted',
  meta: { width: 800, height: 600, size: 100, type: 0 },
  artifact: { key: 'job-a', ext: 'webp' },
  url: 'https://host/a.webp',
  createdAt: 1_000,
  ...over,
});

test('hosted cards: only a complete hosted record draws one', () => {
  const none = new Set<string>();
  const cards = (records: PhotoRecord[], landed = none, live = none): string[] =>
    hostedPhotoCards(records, { landed, live }).map((fields) => fields.sha256);

  assert.deepEqual(hostedPhotoCards([hostedRecord()], { landed: none, live: none }), [
    {
      sha256: 'sha-a',
      url: 'https://host/a.webp',
      width: 800,
      height: 600,
      size: 100,
      type: 0,
      createdAt: 1_000,
    },
  ]);
  // `uploading` and `failed` belong to the worker: it replays them as jobs of its own.
  assert.deepEqual(cards([hostedRecord({ status: 'uploading' })]), []);
  assert.deepEqual(cards([hostedRecord({ status: 'failed' })]), []);
  // A record without the three fields a card renders is not a card.
  assert.deepEqual(cards([hostedRecord({ url: undefined })]), []);
  assert.deepEqual(cards([hostedRecord({ meta: undefined })]), []);
  assert.deepEqual(cards([hostedRecord({ createdAt: undefined })]), []);
  // Upload order is the record order.
  assert.deepEqual(
    cards([hostedRecord(), hostedRecord({ sha256: 'sha-b', url: 'https://host/b.webp' })]),
    ['sha-a', 'sha-b'],
  );
});

// Deliberately kept beside the store-level case further down, which asserts the same two lines
// of `hostedPhotoCards` through `engine.hostedPhotos()`. This one pins the projection on its own
// inputs, so a change to the filter fails here without a store in the picture.
test('hosted cards: a landed or live sha never draws a second card (pure projection)', () => {
  const none = new Set<string>();
  const record = hostedRecord();
  assert.deepEqual(hostedPhotoCards([record], { landed: new Set(['sha-a']), live: none }), []);
  assert.deepEqual(hostedPhotoCards([record], { landed: none, live: new Set(['sha-a']) }), []);
  assert.deepEqual(hostedPhotoCards([record], { landed: none, live: none }).length, 1);
});

test('hosted cards: an unchanged projection keeps its identity', () => {
  const none = new Set<string>();
  const [one] = hostedPhotoCards([hostedRecord()], { landed: none, live: none });
  const [same] = hostedPhotoCards([hostedRecord()], { landed: none, live: none });
  assert.equal(sameHostedCards([one!], [same!]), true);
  assert.equal(sameHostedCards([one!], [one!, one!]), false);
  assert.equal(sameHostedCards([one!], [{ ...one!, url: 'https://host/b.webp' }]), false);
  assert.equal(sameHostedCards([one!], [{ ...one!, createdAt: 2_000 }]), false);
});

// ---- the durable record, through the engine ------------------------------------------------

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
  vi.unstubAllGlobals();
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

type Logged = Array<[string, string | undefined]>;
/** The queue, as `[type, targetSha]` — what both the ordering cases and the counts read. */
const logged = async (): Promise<Logged> =>
  (await readOps(db)).map((entry) => [entry.op.type, entry.op.targetSha]);
const loggedCount = async (): Promise<number> => (await readOps(db)).length;

/** The direct path appends fire-and-forget, so wait for the write rather than assume it. */
const expectLog = (entries: Logged): Promise<void> =>
  vi.waitFor(async () => assert.deepEqual(await logged(), entries));

/** Drain the microtasks and IndexedDB events a queued append would have needed. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

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
  assert.equal(await loggedCount(), 2);
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

  assert.equal(await loggedCount(), 0, 'confirmed keys are cleared');
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
  assert.equal(await loggedCount(), 1, 'only the other photo op is left');
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

// ---- the store's own read, guarded from source ---------------------------------------------

/** The body of a top-level function in the store. */
function bodyOf(header: RegExp): string {
  const start = store.search(header);
  assert.ok(start >= 0, `no match for ${header}`);
  const from = store.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < store.length; i++) {
    if (store[i] === '{') depth++;
    else if (store[i] === '}') {
      depth--;
      if (depth === 0) return store.slice(from, i + 1);
    }
  }
  assert.fail(`unterminated body for ${header}`);
}

// Where a pending card's local preview comes from. The store owns one object URL per job and has
// exactly one source for it — the OPFS artifact. Seeding it from the picked file at enqueue looks
// harmless and is not: the pick's Blob URL dies with the page, so a replayed job had no preview,
// and a GIF card renders <video> (type 1), which cannot decode a GIF, so every GIF upload sat on
// its skeleton for the whole transfer.
test('upload preview: the artifact is the only source', () => {
  const ensure = bodyOf(/async function ensureArtifactPreview\(/);
  assert.ok(ensure.includes('readArtifact('), 'the preview does not read the OPFS artifact');
  assert.ok(ensure.includes('previewUrls.set('), 'the artifact read publishes no preview');
});

test('upload preview: the picked file never seeds it', () => {
  const added = bodyOf(/function addFiles\(/);
  assert.equal(
    added.includes('createObjectURL'),
    false,
    'addFiles seeds a preview from the picked file; a card only exists after stage 1, and a GIF cannot render from its own bytes',
  );
});

// The record path cannot be unit-tested end to end (the store pulls in the SharedWorker bundle),
// so its wiring is asserted here: the cards a reload shows come from the durable photo records
// through the engine, projected by the one pure rule — never from an artifact.
test('upload preview: record cards are projected from the records, not from a job', () => {
  const refresh = bodyOf(/async function refreshHostedPhotos\(/);
  assert.ok(refresh.includes('engine.hostedPhotos('), 'the projection does not read the records');
  assert.ok(refresh.includes('hostedPhotoCards('), 'the projection skips the one pure rule');
  assert.equal(
    refresh.includes('previewUrls'),
    false,
    'a hosted card must not claim an OPFS preview: it renders the hosted URL, and the artifact is pruned',
  );
});

// ---- ops that must wait for the row that makes them meaningful ------------------------------

test('a mark on a pending photo waits for its upload op, and dies with the card', async () => {
  const store = createAppStore(new SyncEngine({ db }));
  store.applySync(snapshot([]));

  // The row does not exist yet: nothing reaches the log, even once the queue has drained.
  store.toggleMark('sha-pending', 'like');
  await settle();
  assert.deepEqual(await logged(), []);

  // The upload op lands: the waiting mark is released right after it.
  await store.photoOpQueued('sha-pending');
  assert.deepEqual(await logged(), [['like', 'sha-pending']]);

  // The row now counts as existing, so a second toggle goes straight to the log — and the
  // engine supersedes the queued like rather than chaining onto it.
  store.toggleMark('sha-pending', 'like');
  await expectLog([['unlike', 'sha-pending']]);

  // A photo the snapshot carries is never deferred.
  store.applySync(snapshot([photo(1, 'sha-known')]));
  store.toggleMark('sha-known', 'like');
  await expectLog([
    ['unlike', 'sha-pending'],
    ['like', 'sha-known'],
  ]);

  // A card that is gone for good never gets its upload op, so its waiting ops go with it.
  store.toggleMark('sha-doomed', 'like');
  store.forgetPendingPhoto('sha-doomed');
  await store.photoOpQueued('sha-doomed');
  await settle();
  assert.equal((await logged()).length, 2);
});

// The net-zero interaction: upload a photo, like it while it uploads, then delete it. The like
// never reaches the log, and the delete leaves exactly one entry — the tombstone, which is the
// safety net for an upload op a sync request may already carry. It is a no-op on the server
// (unknown sha) and is cleared as confirmed at the next sync.
test('upload + like + delete on one photo leaves exactly the tombstone', async () => {
  const store = createAppStore(new SyncEngine({ db }));
  // The upload store registers this sink; here it is what cancels the card, which is what
  // drops the deferred mark.
  setPendingUploadCancelSink((sha) => store.forgetPendingPhoto(sha));
  store.applySync(snapshot([]));

  store.toggleMark('sha-x', 'like');
  store.deletePhotos(['sha-x']);
  await settle();
  assert.deepEqual(await logged(), [['delete', 'sha-x']]);

  setPendingUploadCancelSink(() => undefined);
});

// The optimistic removal runs before the op is submitted, so a delete must not be filtered by
// "does this sha still exist in photos?" — it was, and every synced-photo deletion went
// unqueued: the card vanished and the photo came back with the next snapshot.
test('deleting a synced photo queues its delete op', async () => {
  const store = createAppStore(new SyncEngine({ db }));
  store.applySync(snapshot([photo(1, 'sha-live'), photo(2, 'sha-keep')]));
  assert.equal(store.photos.length, 2);

  store.deletePhotos(['sha-live']);
  assert.equal(store.photos.length, 1, 'the optimistic removal still happens');
  await expectLog([['delete', 'sha-live']]);

  // A non-root visitor cannot delete at all.
  const guest = createAppStore(new SyncEngine({ db }));
  guest.applySync({ ...snapshot([photo(1, 'sha-live')]), selfId: 4 });
  guest.deletePhotos(['sha-live']);
  await settle();
  assert.equal((await logged()).length, 1, 'no op for a visitor who may not delete');
});
