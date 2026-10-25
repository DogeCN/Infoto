import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EMPTY_MARKS } from '../../src/core/ops';
import type { PhotoRecord } from '../../src/core/oplog';
import {
  hostedPhotoCards,
  pendingMediaUrl,
  pendingPhoto,
  rendersCard,
  sameHostedCards,
  samePendingPhoto,
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

test('hosted cards: a landed or live sha never draws a second card', () => {
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
