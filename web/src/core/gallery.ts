import type { Photo } from '$shared/types';

export type SortKey = 'latest' | 'hottest' | 'random';
export type SortDirections = Partial<Record<SortKey, boolean>>;

/** Net reaction score: likes minus dislikes. Also the `heat` filter dimension. */
export function heat(photo: Photo): number {
  return photo.likes.length - photo.dislikes.length;
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function sortPhotos(
  photos: readonly Photo[],
  key: SortKey,
  directions: SortDirections = {},
  randomOrder: readonly number[] = [],
): Photo[] {
  const result = [...photos];
  const ascending = directions[key] ?? false;

  if (key === 'latest') {
    // Equal timestamps are still possible (two uploads in one millisecond, or a server-side
    // clamp), and a stable sort alone would leave "latest" dependent on snapshot order. Id is
    // insertion order, so it is the honest tiebreak: a later row is the later upload.
    return result.sort((a, b) => {
      const byTime = ascending ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      if (byTime !== 0) return byTime;
      return ascending ? a.id - b.id : b.id - a.id;
    });
  }

  if (key === 'hottest') {
    return result.sort((a, b) => (ascending ? heat(a) - heat(b) : heat(b) - heat(a)));
  }

  const byId = new Map(result.map((photo) => [photo.id, photo]));
  const ordered: Photo[] = [];
  const seen = new Set<number>();
  for (const id of randomOrder) {
    const photo = byId.get(id);
    if (photo && !seen.has(id)) {
      ordered.push(photo);
      seen.add(id);
    }
  }
  return [...ordered, ...result.filter((photo) => !seen.has(photo.id))];
}
