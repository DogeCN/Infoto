import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Photo } from '../../../src/shared/types';
import { shuffle, sortPhotos } from '../../src/core/gallery';

function photo(
  id: number,
  createdAt: number,
  likes: number[] = [],
  dislikes: number[] = [],
): Photo {
  return {
    id,
    sha256: `sha-${id}`,
    url: `https://media.test/${id}.webp`,
    uploader: 0,
    width: 800,
    height: 600,
    size: 1024,
    createdAt,
    type: 0,
    likes,
    dislikes,
    reports: [],
  };
}

test('gallery ordering: sorts chronologically and by net reactions without mutating the input', () => {
  const photos = [photo(1, 10, [1]), photo(2, 30, [1, 2, 3]), photo(3, 20, [], [1])];

  assert.deepEqual(
    sortPhotos(photos, 'latest').map((item) => item.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    sortPhotos(photos, 'latest', { latest: true }).map((item) => item.id),
    [1, 3, 2],
  );
  assert.deepEqual(
    sortPhotos(photos, 'hottest').map((item) => item.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    sortPhotos(photos, 'hottest', { hottest: true }).map((item) => item.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    photos.map((item) => item.id),
    [1, 2, 3],
  );
});

test('gallery ordering: preserves a shuffled order and appends photos missing from that order', () => {
  const photos = [photo(1, 10), photo(2, 20), photo(3, 30), photo(4, 40)];

  assert.deepEqual(
    sortPhotos(photos, 'random', {}, [3, 99, 3, 1]).map((item) => item.id),
    [3, 1, 2, 4],
  );
});

test('gallery ordering: shuffles a copy using the supplied random source', () => {
  const values = [1, 2, 3, 4];
  const randomValues = [0, 0.5, 0];
  let index = 0;

  assert.deepEqual(
    shuffle(values, () => randomValues[index++]!),
    [3, 4, 2, 1],
  );
  assert.deepEqual(values, [1, 2, 3, 4]);
});
