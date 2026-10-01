import { describe, expect, it } from 'vitest';
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

describe('gallery ordering', () => {
  it('sorts chronologically and by net reactions without mutating the input', () => {
    const photos = [photo(1, 10, [1]), photo(2, 30, [1, 2, 3]), photo(3, 20, [], [1])];

    expect(sortPhotos(photos, 'latest').map((item) => item.id)).toEqual([2, 3, 1]);
    expect(sortPhotos(photos, 'latest', { latest: true }).map((item) => item.id)).toEqual([
      1, 3, 2,
    ]);
    expect(sortPhotos(photos, 'hottest').map((item) => item.id)).toEqual([2, 1, 3]);
    expect(sortPhotos(photos, 'hottest', { hottest: true }).map((item) => item.id)).toEqual([
      3, 1, 2,
    ]);
    expect(photos.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('preserves a shuffled order and appends photos missing from that order', () => {
    const photos = [photo(1, 10), photo(2, 20), photo(3, 30), photo(4, 40)];

    expect(sortPhotos(photos, 'random', {}, [3, 99, 3, 1]).map((item) => item.id)).toEqual([
      3, 1, 2, 4,
    ]);
  });

  it('shuffles a copy using the supplied random source', () => {
    const values = [1, 2, 3, 4];
    const randomValues = [0, 0.5, 0];
    let index = 0;

    expect(shuffle(values, () => randomValues[index++]!)).toEqual([3, 4, 2, 1]);
    expect(values).toEqual([1, 2, 3, 4]);
  });
});
