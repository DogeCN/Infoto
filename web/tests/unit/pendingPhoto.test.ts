import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EMPTY_MARKS } from '../../src/core/ops';
import {
  pendingMediaUrl,
  pendingPhoto,
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
