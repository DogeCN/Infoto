// A photo op must follow the upload op that creates its row: /sync applies a batch in array
// order, so a mark sent first is a no-op on an unknown sha (`resolvePhotoId` -> null) and is
// then cleared as confirmed — the mark is silently lost. The store defers such ops until the
// upload op lands, and drops them when the card is gone for good.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Photo, SyncResponse } from '$shared/types';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog';
import { SyncEngine } from '../../src/core/engine';

// The store pulls in svelte-sonner for its toasts, whose own dependency has no node export
// condition; the store's op handling does not touch it.
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const { createAppStore, setPendingUploadCancelSink } =
  await import('../../src/state/appStore.svelte');

let db: IDBDatabase;

beforeEach(async () => {
  db = await openOplogDb();
  await clearOps(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const photo = (id: number, sha: string): Photo => ({
  id,
  sha256: sha,
  url: `https://host/${sha}.webp`,
  uploader: 0,
  width: 10,
  height: 10,
  size: 100,
  createdAt: 0,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
});

const snapshot = (photos: Photo[] = []): SyncResponse => ({
  ok: true,
  serverTime: 1_000,
  selfId: 0,
  mediaHostUrl: 'https://facade.test',
  photos,
  announcements: [],
  polls: [],
  feedback: [],
});

type Logged = Array<[string, string | undefined]>;
const logged = async (): Promise<Logged> =>
  (await readOps(db)).map((entry) => [entry.op.type, entry.op.targetSha]);

/** The direct path appends fire-and-forget, so wait for the write rather than assume it. */
const expectLog = (entries: Logged): Promise<void> =>
  vi.waitFor(async () => assert.deepEqual(await logged(), entries));

/** Drain the microtasks and IndexedDB events a queued append would have needed. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

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
