import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EMPTY_MARKS } from '../../src/core/ops';
import { pendingPhoto, samePendingPhoto, type PendingPhotoFields } from '../../src/core/pending';

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
