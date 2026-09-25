import { describe, expect, it } from 'vitest';
import type { Announcement, Feedback, Photo } from '$shared/types';
import * as ops from '../../src/core/ops';
import { parseVote } from '../../src/core/vote';
import { reactionCounts } from '../../src/core/reactions';
import {
  applyFilters,
  countActiveFilters,
  defaultFilterSettings,
  isFilterable,
  metricOf,
  metricRange,
} from '../../src/settings';
import { normalizeRangeValue, mapRangeValue } from '../../src/lib/components/rangeScale';

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
  title: 't',
  contentMd: 'c',
  sort: 0,
  updatedAt: 0,
  reactions: [],
  votes: [],
  ...over,
});

describe('ops: marks', () => {
  it('toggleId adds / removes idempotently', () => {
    expect(ops.toggleId([], 3, true)).toEqual([3]);
    expect(ops.toggleId([3], 3, true)).toEqual([3]); // already present — no dup
    expect(ops.toggleId([3], 3, false)).toEqual([]);
    expect(ops.toggleId([], 3, false)).toEqual([]); // already absent
  });

  it('applyMark only touches the target photo', () => {
    const list = [photo({ id: 1 }), photo({ id: 2 })];
    const out = ops.applyMark(list, 2, 'like', 7, true);
    expect(out[0]!.likes).toEqual([]);
    expect(out[1]!.likes).toEqual([7]);
    expect(list[1]!.likes).toEqual([]); // original untouched
  });

  it('applyMarkMany covers every selected id', () => {
    const list = [photo({ id: 1 }), photo({ id: 2 }), photo({ id: 3 })];
    const out = ops.applyMarkMany(list, [1, 3], 'dislike', 5, true);
    expect(out.map((p) => p.dislikes.length)).toEqual([1, 0, 1]);
  });

  it('markOpType maps kind + direction to the contract op names', () => {
    expect(ops.markOpType('like', true)).toBe('like');
    expect(ops.markOpType('like', false)).toBe('unlike');
    expect(ops.markOpType('dislike', true)).toBe('dislike');
    expect(ops.markOpType('dislike', false)).toBe('undislike');
    expect(ops.markOpType('report', true)).toBe('report');
    expect(ops.markOpType('report', false)).toBe('unreport');
  });

  it('applyDelete drops the given ids only', () => {
    const list = [photo({ id: 1 }), photo({ id: 2 })];
    expect(ops.applyDelete(list, [1]).map((p) => p.id)).toEqual([2]);
  });
});

describe('ops: announcements', () => {
  it('applyVote keeps one row per user (overwrite, not append)', () => {
    let list = [ann({ id: 1 })];
    list = ops.applyVote(list, 1, 4, 0);
    expect(list[0]!.votes).toEqual([{ userId: 4, option: 0 }]);
    list = ops.applyVote(list, 1, 4, 2);
    expect(list[0]!.votes).toEqual([{ userId: 4, option: 2 }]);
    list = ops.applyVote(list, 1, 4, null);
    expect(list[0]!.votes).toEqual([]);
  });

  it('applyReact replaces the user row and clears on null', () => {
    let list = [ann({ id: 1 })];
    list = ops.applyReact(list, 1, 4, '👍');
    list = ops.applyReact(list, 1, 4, '🔥');
    expect(list[0]!.reactions).toEqual([{ userId: 4, emoji: '🔥' }]);
    list = ops.applyReact(list, 1, 4, null);
    expect(list[0]!.reactions).toEqual([]);
  });

  it('applyAnnReorder normalizes sort to 0…n-1 and appends the unmentioned', () => {
    const list = [ann({ id: 1, sort: 0 }), ann({ id: 2, sort: 1 }), ann({ id: 3, sort: 2 })];
    const out = ops.applyAnnReorder(list, [3, 1]);
    expect(out.map((a) => a.id)).toEqual([3, 1, 2]);
    expect(out.map((a) => a.sort)).toEqual([0, 1, 2]);
  });

  it('applyAnnCreate uses a negative temp id and appends at the end', () => {
    const list = [ann({ id: 1, sort: 0 })];
    const out = ops.applyAnnCreate(list, -1, 'new', 'body', 123);
    expect(out).toHaveLength(2);
    expect(out[1]!).toMatchObject({ id: -1, title: 'new', sort: 1, updatedAt: 123 });
  });
});

describe('ops: temp id resolution', () => {
  it('maps pending temp ids to newly appeared real ids in creation order', () => {
    const server = [ann({ id: 5 }), ann({ id: 6 })];
    const { mapping, unresolved } = ops.resolveTempIds([-1, -2], new Set<number>(), server);
    expect(mapping.get(-1)).toBe(5);
    expect(mapping.get(-2)).toBe(6);
    expect(unresolved).toEqual([]);
  });

  it('keeps temp ids that the server has not returned yet', () => {
    const server = [ann({ id: 5 })];
    const { mapping, unresolved } = ops.resolveTempIds([-1, -2], new Set<number>(), server);
    expect(mapping.get(-1)).toBe(5);
    expect(unresolved).toEqual([-2]);
  });

  it('ignores ids already known from a previous snapshot', () => {
    const server = [ann({ id: 5 }), ann({ id: 6 })];
    const { mapping } = ops.resolveTempIds([-1], new Set([5]), server);
    expect(mapping.get(-1)).toBe(6);
  });

  it('remapOpTarget rewrites only negative targets that are mapped', () => {
    const mapping = new Map([[-1, 9]]);
    expect(ops.remapOpTarget({ type: 'ann_delete', target: -1 }, mapping).target).toBe(9);
    expect(ops.remapOpTarget({ type: 'ann_delete', target: -2 }, mapping).target).toBe(-2);
    expect(ops.remapOpTarget({ type: 'like', target: 3 }, mapping).target).toBe(3);
  });
});

describe('vote parsing', () => {
  it('takes the first :::vote line and strips it from the body', () => {
    const r = parseVote('说明\n:::vote 满意 | 一般 | 不满意\n尾部');
    expect(r.options).toEqual(['满意', '一般', '不满意']);
    expect(r.body).toBe('说明\n尾部');
  });

  it('returns no options when absent (body unchanged)', () => {
    const r = parseVote('纯文本');
    expect(r.options).toEqual([]);
    expect(r.body).toBe('纯文本');
  });

  it('ignores a second :::vote line', () => {
    const r = parseVote(':::vote A | B\n:::vote C | D');
    expect(r.options).toEqual(['A', 'B']);
    expect(r.body).toBe(':::vote C | D');
  });
});

describe('reactions aggregation', () => {
  it('counts per emoji and flags the current user, in fixed set order', () => {
    const a = ann({
      id: 1,
      reactions: [
        { userId: 2, emoji: '🔥' },
        { userId: 1, emoji: '👍' },
        { userId: 3, emoji: '👍' },
      ],
    });
    expect(reactionCounts(a, 1)).toEqual([
      { emoji: '👍', count: 2, selfReacted: true },
      { emoji: '🔥', count: 1, selfReacted: false },
    ]);
  });

  it('omits emojis that never appeared', () => {
    expect(reactionCounts(ann({ id: 1 }), 0)).toEqual([]);
  });
});

describe('filters', () => {
  const photos = [
    photo({ id: 1, type: 0, uploader: 0, likes: [0], size: 10 }),
    photo({ id: 2, type: 1, uploader: 1, dislikes: [0], size: 20 }),
    photo({ id: 3, type: 2, uploader: 0, reports: [0], size: 30 }),
  ];

  it('metricOf: heat is likes − dislikes', () => {
    expect(metricOf(photos[0]!, 'heat')).toBe(1);
    expect(metricOf(photos[1]!, 'heat')).toBe(-1);
    expect(metricOf(photos[2]!, 'likes')).toBe(0);
    expect(metricOf(photos[2]!, 'size')).toBe(30);
  });

  it('metricRange spans the data; null when empty', () => {
    expect(metricRange(photos, 'size')).toEqual([10, 30]);
    expect(metricRange(photos, 'likes')).toEqual([0, 1]);
    expect(metricRange([], 'size')).toBeNull();
  });

  it('isFilterable is false when min = max', () => {
    const flat = [photo({ id: 1, likes: [1] }), photo({ id: 2, likes: [2] })];
    expect(isFilterable(flat, 'likes')).toBe(false);
    expect(isFilterable(flat, 'size')).toBe(false);
    expect(isFilterable(photos, 'size')).toBe(true);
  });

  it('type filter ANDs with ownership tri-state', () => {
    const f = defaultFilterSettings();
    expect(applyFilters(photos, f, 0)).toHaveLength(3);

    f.types = new Set([0, 2]);
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([1, 3]);

    f.ownedByMe = 'only';
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([1, 3]);

    f.ownedByMe = 'exclude';
    expect(applyFilters(photos, f, 0)).toEqual([]);
  });

  it('tri-state only / exclude work on mark arrays', () => {
    const f = defaultFilterSettings();
    f.likedByMe = 'only';
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([1]);
    f.likedByMe = 'exclude';
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([2, 3]);

    const g = defaultFilterSettings();
    g.reportedByMe = 'only';
    expect(applyFilters(photos, g, 0).map((p) => p.id)).toEqual([3]);
  });

  it('range filters clip the result set', () => {
    const f = defaultFilterSettings();
    f.ranges = { size: [15, 25] };
    expect(applyFilters(photos, f, 0).map((p) => p.id)).toEqual([2]);
  });

  it('countActiveFilters counts types, tri-states and ranges', () => {
    const f = defaultFilterSettings();
    expect(countActiveFilters(f)).toBe(0);
    f.types = new Set([0]);
    f.likedByMe = 'only';
    f.ranges = { size: [1, 2] };
    expect(countActiveFilters(f)).toBe(3);
  });
});

describe('ops: feedback', () => {
  it('applyFbCreate prepends; applyFbDelete removes by id', () => {
    let list: Feedback[] = [];
    list = ops.applyFbCreate(list, -1, 0, 'hi', 5);
    expect(list).toEqual([{ id: -1, userId: 0, contentMd: 'hi', createdAt: 5 }]);
    expect(ops.applyFbDelete(list, -1)).toEqual([]);
  });
});

describe('slider scale mapping', () => {
  it('linear maps endpoints and reverses with rounding', () => {
    expect(normalizeRangeValue(0, 0, 100, 'linear')).toBe(0);
    expect(normalizeRangeValue(100, 0, 100, 'linear')).toBe(1);
    expect(mapRangeValue(0.255, 0, 100, 'linear')).toBe(26);
  });

  it('log map keeps the low end usable across orders of magnitude', () => {
    expect(normalizeRangeValue(0, 0, 10_000_000, 'logarithmic')).toBe(0);
    expect(normalizeRangeValue(10_000_000, 0, 10_000_000, 'logarithmic')).toBe(1);
    // 1 KB resolves to a meaningful fraction instead of near-zero.
    expect(normalizeRangeValue(1024, 0, 10_000_000, 'logarithmic')).toBeGreaterThan(0.3);
    expect(mapRangeValue(0, 0, 10_000_000, 'logarithmic')).toBe(0);
    expect(mapRangeValue(1, 0, 10_000_000, 'logarithmic')).toBe(10_000_000);
  });
});
