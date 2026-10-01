import { describe, expect, it } from 'vitest';
import type { Announcement, Feedback, Photo, Poll } from '$shared/types';
import * as ops from '../../src/core/ops';
import { splitVoteReferences } from '../../src/core/markdown';
import { reactionCounts } from '../../src/core/reactions';
import {
  applyFilters,
  countActiveFilters,
  defaultFilterSettings,
  isFilterable,
  metricOf,
  metricRange,
} from '../../src/settings';
import { mapRangeValue, normalizeRangeValue } from '../../src/base/lib/slider';

const photo = (over: Partial<Photo> & { id: number }): Photo => ({
  sha256: `h${over.id}`,
  url: `https://host/${over.id}.webp`,
  uploader: 0,
  width: 10,
  height: 10,
  size: 100,
  createdAt: over.id,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
  ...over,
});

const ann = (over: Partial<Announcement> & { id: number }): Announcement => ({
  locale: 'en-US',
  title: 't',
  contentMd: 'c',
  sort: 0,
  updatedAt: 0,
  reactions: [],
  ...over,
});

const poll = (over: Partial<Poll> & { id: number }): Poll => ({
  locale: 'en-US',
  title: 'Question',
  options: ['A', 'B', 'C'],
  allowMultiple: true,
  sort: 0,
  createdAt: 0,
  updatedAt: 0,
  votes: [],
  ...over,
});

describe('frontend ops and filters', () => {
  it('applies marks, deletes, and announcement writes without mutating the source', () => {
    expect(ops.toggleId([], 3, true)).toEqual([3]);
    expect(ops.toggleId([3], 3, true)).toEqual([3]);
    expect(ops.toggleId([3], 3, false)).toEqual([]);
    expect(ops.toggleId([], 3, false)).toEqual([]);
    const list = [photo({ id: 1 }), photo({ id: 2 }), photo({ id: 3 })];
    const marked = ops.applyMark(list, 2, 'like', 7, true);
    expect(marked[0]!.likes).toEqual([]);
    expect(marked[1]!.likes).toEqual([7]);
    expect(list[1]!.likes).toEqual([]);
    expect(
      ops.applyMarkMany(list, [1, 3], 'dislike', 5, true).map((p) => p.dislikes.length),
    ).toEqual([1, 0, 1]);
    expect(ops.markOpType('like', false)).toBe('unlike');
    expect(ops.markOpType('dislike', true)).toBe('dislike');
    expect(ops.markOpType('report', false)).toBe('unreport');
    expect(ops.applyDelete(list, [1]).map((p) => p.id)).toEqual([2, 3]);

    let polls = [poll({ id: 0 })];
    polls = ops.applyVote(polls, 0, 4, [0]);
    polls = ops.applyVote(polls, 0, 4, [1, 2]);
    expect(polls[0]!.votes).toEqual([
      { userId: 4, option: 1 },
      { userId: 4, option: 2 },
    ]);
    polls = ops.applyVote(polls, 0, 4, []);
    expect(polls[0]!.votes).toEqual([]);
    const announcements = [ann({ id: 1 })];
    let reacted = ops.applyReact(announcements, 1, 4, '👍');
    reacted = ops.applyReact(reacted, 1, 4, '🔥');
    expect(reacted[0]!.reactions).toEqual([{ userId: 4, emoji: '🔥' }]);
    reacted = ops.applyReact(reacted, 1, 4, null);
    expect(reacted[0]!.reactions).toEqual([]);
    const reordered = ops.applyReorder(
      [ann({ id: 1, sort: 0 }), ann({ id: 2, sort: 1 }), ann({ id: 3, sort: 2 })],
      [3, 1],
    );
    expect(reordered.map((a) => a.id)).toEqual([3, 1, 2]);
    expect(reordered.map((a) => a.sort)).toEqual([0, 1, 2]);
    expect(
      ops.applyAnnCreate([ann({ id: 1, sort: 0 })], -1, 'new', 'body', 'en-US', 123)[1],
    ).toMatchObject({
      id: -1,
      locale: 'en-US',
      title: 'new',
      sort: 1,
      updatedAt: 123,
    });

    let feedback: Feedback[] = [];
    feedback = ops.applyFbCreate(feedback, -1, 0, 'hi', 'en-US', 5);
    expect(feedback).toEqual([
      { id: -1, userId: 0, locale: 'en-US', contentMd: 'hi', createdAt: 5, sort: -1 },
    ]);
    feedback = ops.applyFbCreate(feedback, -2, 0, 'newer', 'en-US', 6);
    expect(feedback.map((f) => f.sort)).toEqual([-2, -1]);
    expect(ops.applyFbDelete(feedback, -1).map((f) => f.id)).toEqual([-2]);
  });

  it('splits canonical poll references and counts reactions in set order', () => {
    expect(splitVoteReferences('说明\n::vote:0\n尾部')).toEqual([
      { type: 'markdown', content: '说明\n' },
      { type: 'vote', pollId: 0 },
      { type: 'markdown', content: '\n尾部' },
    ]);
    expect(splitVoteReferences('::vote:2 and ::vote:12')).toEqual([
      { type: 'vote', pollId: 2 },
      { type: 'markdown', content: ' and ' },
      { type: 'vote', pollId: 12 },
    ]);
    expect(splitVoteReferences('::vote:01 ::vote:-1 ::vote:9007199254740992')).toEqual([
      { type: 'markdown', content: '::vote:01 ::vote:-1 ::vote:9007199254740992' },
    ]);
    expect(
      reactionCounts(
        ann({
          id: 1,
          reactions: [
            { userId: 2, emoji: '🔥' },
            { userId: 1, emoji: '👍' },
            { userId: 3, emoji: '👍' },
          ],
        }),
        1,
      ),
    ).toEqual([
      { emoji: '👍', count: 2, selfReacted: true },
      { emoji: '🔥', count: 1, selfReacted: false },
    ]);
    expect(reactionCounts(ann({ id: 1 }), 0)).toEqual([]);
  });

  it('filters by type, ownership, marks, and ranges', () => {
    const photos = [
      photo({ id: 1, type: 0, uploader: 0, likes: [0], size: 10 }),
      photo({ id: 2, type: 1, uploader: 1, dislikes: [0], size: 20 }),
      photo({ id: 3, type: 2, uploader: 0, reports: [0], size: 30 }),
    ];
    expect(metricOf(photos[0]!, 'heat')).toBe(1);
    expect(metricOf(photos[1]!, 'heat')).toBe(-1);
    expect(metricRange(photos, 'size')).toEqual([10, 30]);
    expect(metricRange([], 'size')).toBeNull();
    const flat = [photo({ id: 1, likes: [1] }), photo({ id: 2, likes: [2] })];
    expect(isFilterable(flat, 'likes')).toBe(false);
    expect(isFilterable(photos, 'size')).toBe(true);

    const f = defaultFilterSettings();
    expect(applyFilters(photos, f, 0)).toHaveLength(3);
    f.types = new Set([0, 2]);
    f.ownedByMe = 'only';
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([1, 3]);
    f.ownedByMe = 'exclude';
    expect(applyFilters(photos, f, 0)).toEqual([]);
    const liked = defaultFilterSettings();
    liked.likedByMe = 'only';
    expect(applyFilters(photos, liked, 0).map((p) => p.id)).toEqual([1]);
    liked.likedByMe = 'exclude';
    expect(applyFilters(photos, liked, 0).map((p) => p.id)).toEqual([2, 3]);
    const reported = defaultFilterSettings();
    reported.reportedByMe = 'only';
    expect(applyFilters(photos, reported, 0).map((p) => p.id)).toEqual([3]);
    const ranged = defaultFilterSettings();
    ranged.ranges = { size: [15, 25] };
    expect(applyFilters(photos, ranged, 0).map((p) => p.id)).toEqual([2]);
    expect(countActiveFilters(defaultFilterSettings())).toBe(0);
    const counted = defaultFilterSettings();
    counted.types = new Set([0]);
    counted.likedByMe = 'only';
    counted.ranges = { size: [1, 2] };
    expect(countActiveFilters(counted)).toBe(3);
  });

  it('maps linear and logarithmic slider positions', () => {
    expect(normalizeRangeValue(0, 0, 100, 'linear')).toBe(0);
    expect(normalizeRangeValue(100, 0, 100, 'linear')).toBe(1);
    expect(mapRangeValue(0.255, 0, 100, 'linear')).toBe(26);
    expect(normalizeRangeValue(0, 0, 10_000_000, 'logarithmic')).toBe(0);
    expect(normalizeRangeValue(10_000_000, 0, 10_000_000, 'logarithmic')).toBe(1);
    expect(normalizeRangeValue(1024, 0, 10_000_000, 'logarithmic')).toBeGreaterThan(0.3);
    expect(mapRangeValue(1, 0, 10_000_000, 'logarithmic')).toBe(10_000_000);
  });
});
