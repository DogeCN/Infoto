import { test } from 'vitest';
import assert from 'node:assert/strict';
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
  options: ['A', 'B', 'C'],
  allowMultiple: true,
  locale: 'en-US',
  sort: id,
  updatedAt: 0,
  votes: [],
});

test('reapplyQueued: folds queued photo, announcement, and poll ops onto the snapshot', () => {
  assert.deepEqual(
    reapplyQueued([photo(1, [7])], [], [], [{ type: 'unlike', targetSha: 'sha-1' }], 7).photos[0]!
      .likes,
    [],
  );
  assert.deepEqual(
    reapplyQueued([photo(9, [], 'sha-9')], [], [], [{ type: 'like', targetSha: 'sha-9' }], 7)
      .photos[0]!.likes,
    [7],
  );
  const untouched = [photo(1)];
  assert.equal(
    reapplyQueued(untouched, [], [], [{ type: 'delete', targetSha: 'sha-missing' }], 7).photos,
    untouched,
  );

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
  assert.equal(
    folded.photos.find((item) => item.id === 1),
    undefined,
  );
  assert.deepEqual(folded.photos[0]!.dislikes, [7]);
  assert.deepEqual(folded.polls[0]!.votes, [
    { userId: 7, option: 1 },
    { userId: 7, option: 2 },
  ]);
  assert.deepEqual(folded.announcements[0]!.reactions, [{ userId: 7, emoji: '👍' }]);

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
  assert.equal(kept.photos.length, 1);
  const same = [photo(1, [7])];
  assert.equal(reapplyQueued(same, [], [], [], 7).photos, same);
});
