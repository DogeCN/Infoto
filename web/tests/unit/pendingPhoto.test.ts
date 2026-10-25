import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Op } from '$shared/types';
import { EMPTY_MARKS } from '../../src/core/ops';
import {
  pendingMediaUrl,
  pendingPhoto,
  queuedUploadCards,
  queuedUploadFromOp,
  rendersCard,
  samePendingPhoto,
  sameQueuedUploads,
  type PendingPhotoFields,
} from '../../src/core/pending';

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

/** An `upload` op as the SharedWorker writes one, with a field overridden or removed. */
const uploadOp = (over: Record<string, unknown> = {}): Op => ({
  type: 'upload',
  target: null,
  payload: {
    sha256: 'sha-a',
    url: 'https://host/a.webp',
    width: 800,
    height: 600,
    size: 100,
    type: 0,
    createdAt: 1_000,
    ...over,
  },
});

// An upload op is written only after the facade returned the URL, so it is the whole record of
// a hosted photo that is not in the album yet — the only thing left after a reload drops the
// card. A payload the server would refuse must not project a card either, or it could never go
// away.
test('queued upload: the op is a card only when its payload is complete', () => {
  assert.deepEqual(queuedUploadFromOp(uploadOp()), {
    sha256: 'sha-a',
    url: 'https://host/a.webp',
    width: 800,
    height: 600,
    size: 100,
    type: 0,
    createdAt: 1_000,
  });

  // Other op kinds contribute nothing.
  assert.equal(queuedUploadFromOp({ type: 'like', targetSha: 'sha-a' }), null);

  for (const bad of [
    { sha256: '' },
    { sha256: undefined },
    { sha256: 'a'.repeat(129) },
    { url: '' },
    { url: 'https://host/' + 'a'.repeat(2049) },
    { width: undefined },
    { width: -1 },
    { width: 1.5 },
    { size: -1 },
    { type: 3 },
    { type: undefined },
    { createdAt: 0 },
    { createdAt: undefined },
  ]) {
    assert.equal(queuedUploadFromOp(uploadOp(bad)), null, JSON.stringify(bad));
  }

  // The server accepts a zero box (`count()` is `>= 0`), so the projection must too: hiding a
  // photo the server would keep is the invisible-photo bug in miniature. The layout already
  // defends the empty box with `w: p.width || 1`.
  assert.equal(queuedUploadFromOp(uploadOp({ width: 0, height: 0 }))?.width, 0);
});

test('queued upload: the log projects cards in order, without a landed or live duplicate', () => {
  const a = uploadOp({ sha256: 'a', url: 'https://host/a.webp' });
  const b = uploadOp({ sha256: 'b', url: 'https://host/b.webp' });
  const none = new Set<string>();

  const shas = (ops: Op[], landed = none, live = none): string[] =>
    queuedUploadCards(ops, { landed, live }).map((fields) => fields.sha256);

  // Submission order, and a mark op between two uploads contributes nothing.
  assert.deepEqual(shas([a, { type: 'like', targetSha: 'a' }, b]), ['a', 'b']);
  // A sha the snapshot carries renders as the real photo, not as its op's card.
  assert.deepEqual(shas([a, b], new Set(['a'])), ['b']);
  // A live job owns its own card; the projection must not draw a second one.
  assert.deepEqual(shas([a, b], none, new Set(['b'])), ['a']);
  // Picking the same file twice uploads twice and logs two ops for one photo: one card.
  assert.deepEqual(shas([a, uploadOp({ sha256: 'a' })]), ['a']);
  // The card carries the hosted URL and the upload instant the op recorded.
  assert.equal(queuedUploadCards([a], { landed: none, live: none })[0]!.url, 'https://host/a.webp');
});

test('queued upload: an unchanged projection keeps its identity', () => {
  const [one] = queuedUploadCards([uploadOp()], { landed: new Set(), live: new Set() });
  const [same] = queuedUploadCards([uploadOp()], { landed: new Set(), live: new Set() });
  assert.equal(sameQueuedUploads([one!], [same!]), true);
  assert.equal(sameQueuedUploads([one!], [one!, one!]), false);
  assert.equal(sameQueuedUploads([one!], [{ ...one!, url: 'https://host/b.webp' }]), false);
  assert.equal(sameQueuedUploads([one!], [{ ...one!, createdAt: 2_000 }]), false);
});
