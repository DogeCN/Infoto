import { describe, expect, it } from 'vitest';
import { reapplyQueued } from '../../src/core/ops';
import type { Announcement, Op, Photo } from '$shared/types';

/** `sha` defaults to the id-derived hash, so an op can be written as `{ type, targetSha: 'sha-1' }`. */
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
  sort: id,
  updatedAt: 0,
  reactions: [],
  votes: [],
});

describe('reapplyQueued', () => {
  it('re-folds a queued unlike onto a stale snapshot (optimistic state survives)', () => {
    // Server snapshot computed BEFORE the unlike reached the server: still liked.
    const stale = [photo(1, [7])];
    // Photo ops address the photo by sha256, never by its numeric id.
    const queued: Op[] = [{ type: 'unlike', targetSha: 'sha-1' }];
    const out = reapplyQueued(stale, [], queued, 7);
    expect(out.photos[0]!.likes).toEqual([]);
  });

  it('folds an op written while the photo was still uploading once the row lands', () => {
    // The op was queued during the upload (no id existed yet, so it carries the hash).
    // /sync brings the row in; the queued op must fold onto it rather than be dropped.
    const queued: Op[] = [{ type: 'like', targetSha: 'sha-9' }];
    const out = reapplyQueued([photo(9, [], 'sha-9')], [], queued, 7);
    expect(out.photos[0]!.likes).toEqual([7]);
  });

  it('drops a hash-addressed op whose photo is not in the snapshot (no orphan)', () => {
    const photos = [photo(1)];
    const out = reapplyQueued(photos, [], [{ type: 'delete', targetSha: 'sha-missing' }], 7);
    expect(out.photos).toBe(photos);
  });

  it('re-folds queued like, dislike exclusion, delete, vote, react', () => {
    const out = reapplyQueued(
      [photo(1), photo(2, [7])],
      [ann(10)],
      [
        { type: 'like', targetSha: 'sha-1' },
        { type: 'dislike', targetSha: 'sha-2' }, // must clear the like (mutual exclusion is toggleMark's job; reducer just applies)
        { type: 'delete', targetSha: 'sha-1' },
        { type: 'vote', target: 10, payload: { option: 1 } },
        { type: 'react', target: 10, payload: { emoji: '👍' } },
      ],
      7,
    );
    expect(out.photos.find((p) => p.id === 1)).toBeUndefined();
    expect(out.photos[0]!.dislikes).toEqual([7]);
    expect(out.announcements[0]!.votes).toEqual([{ userId: 7, option: 1 }]);
    expect(out.announcements[0]!.reactions).toEqual([{ userId: 7, emoji: '👍' }]);
  });

  it('ignores upload / fb_create (managed outside the fold)', () => {
    const out = reapplyQueued(
      [photo(1)],
      [],
      [
        {
          type: 'upload',
          payload: { sha256: 'x', url: 'u', width: 1, height: 1, size: 1, type: 0 },
        },
        { type: 'fb_create', payload: { contentMd: 'y' } },
      ],
      7,
    );
    expect(out.photos).toHaveLength(1);
  });

  it('no queued ops → snapshot passes through unchanged', () => {
    const photos = [photo(1, [7])];
    const out = reapplyQueued(photos, [], [], 7);
    expect(out.photos).toBe(photos);
  });
});
