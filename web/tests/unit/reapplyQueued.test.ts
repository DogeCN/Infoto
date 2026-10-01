import { describe, expect, it } from 'vitest';
import { reapplyQueued } from '../../src/core/ops';
import type { Announcement, Photo, Poll } from '$shared/types';

const photo = (id: number, likes: number[] = [], sha = `sha-${id}`): Photo => ({
  id,
  uploader: 0,
  sha256: sha,
  url: `https://cdn.test/${id}.webp`,
  width: 100,
  height: 100,
  size: 1000,
  type: 0,
  createdAt: 0,
  likes,
  dislikes: [],
  reports: [],
});

const ann = (id: number): Announcement => ({
  id,
  title: `t${id}`,
  contentMd: '',
  locale: 'en-US',
  sort: id,
  updatedAt: 0,
  reactions: [],
});

const poll = (id: number): Poll => ({
  id,
  title: `poll${id}`,
  options: ['A', 'B', 'C'],
  allowMultiple: true,
  locale: 'en-US',
  sort: id,
  votes: [],
});

describe('reapplyQueued', () => {
  it('folds queued photo, announcement, and poll ops onto the snapshot', () => {
    expect(
      reapplyQueued([photo(1, [7])], [], [], [{ type: 'unlike', targetSha: 'sha-1' }], 7).photos[0]!
        .likes,
    ).toEqual([]);
    expect(
      reapplyQueued([photo(9, [], 'sha-9')], [], [], [{ type: 'like', targetSha: 'sha-9' }], 7)
        .photos[0]!.likes,
    ).toEqual([7]);
    const untouched = [photo(1)];
    expect(
      reapplyQueued(untouched, [], [], [{ type: 'delete', targetSha: 'sha-missing' }], 7).photos,
    ).toBe(untouched);

    const folded = reapplyQueued(
      [photo(1), photo(2, [7])],
      [ann(10)],
      [poll(20)],
      [
        { type: 'like', targetSha: 'sha-1' },
        { type: 'dislike', targetSha: 'sha-2' },
        { type: 'delete', targetSha: 'sha-1' },
        { type: 'vote', target: 20, payload: { options: [1, 2] } },
        { type: 'react', target: 10, payload: { emoji: '👍' } },
      ],
      7,
    );
    expect(folded.photos.find((item) => item.id === 1)).toBeUndefined();
    expect(folded.photos[0]!.dislikes).toEqual([7]);
    expect(folded.polls[0]!.votes).toEqual([
      { userId: 7, option: 1 },
      { userId: 7, option: 2 },
    ]);
    expect(folded.announcements[0]!.reactions).toEqual([{ userId: 7, emoji: '👍' }]);

    const kept = reapplyQueued(
      [photo(1)],
      [],
      [],
      [
        {
          type: 'upload',
          payload: { sha256: 'x', url: 'u', width: 1, height: 1, size: 1, type: 0 },
        },
        { type: 'fb_create', payload: { contentMd: 'y', locale: 'en-US' } },
      ],
      7,
    );
    expect(kept.photos).toHaveLength(1);
    const same = [photo(1, [7])];
    expect(reapplyQueued(same, [], [], [], 7).photos).toBe(same);
  });
});
