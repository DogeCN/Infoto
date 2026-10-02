import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Announcement, Feedback, Photo, Poll } from '$shared/types';
import * as ops from '../../src/core/ops';
import { splitPollReferences } from '../../src/core/markdown';
import { reactionCounts } from '../../src/core/reactions';
import {
  applyFilters,
  countActiveFilters,
  defaultFilterSettings,
  isFilterable,
  metricOf,
  metricRange,
} from '../../src/settings';

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
  locale: 'en-US',
  sort: 0,
  updatedAt: 0,
  reactions: [],
  ...over,
});

const poll = (over: Partial<Poll> & { id: number }): Poll => ({
  title: 'question',
  options: ['A', 'B', 'C'],
  allowMultiple: false,
  locale: 'en-US',
  sort: 0,
  updatedAt: 1_000,
  votes: [],
  ...over,
});

test('frontend ops and filters: applies marks, independent polls, and announcement writes without mutating the source', () => {
  assert.deepEqual(ops.toggleId([], 3, true), [3]);
  assert.deepEqual(ops.toggleId([3], 3, true), [3]);
  assert.deepEqual(ops.toggleId([3], 3, false), []);
  assert.deepEqual(ops.toggleId([], 3, false), []);
  const list = [photo({ id: 1 }), photo({ id: 2 }), photo({ id: 3 })];
  const marked = ops.applyMark(list, 2, 'like', 7, true);
  assert.deepEqual(marked[0]!.likes, []);
  assert.deepEqual(marked[1]!.likes, [7]);
  assert.deepEqual(list[1]!.likes, []);
  assert.deepEqual(
    ops.applyMarkMany(list, [1, 3], 'dislike', 5, true).map((p) => p.dislikes.length),
    [1, 0, 1],
  );
  assert.equal(ops.markOpType('like', false), 'unlike');
  assert.equal(ops.markOpType('dislike', true), 'dislike');
  assert.equal(ops.markOpType('report', false), 'unreport');
  assert.deepEqual(
    ops.applyDelete(list, [1]).map((p) => p.id),
    [2, 3],
  );

  let polls = [poll({ id: 1, allowMultiple: true })];
  polls = ops.applyVote(polls, 1, 4, [0, 2]);
  assert.deepEqual(polls[0]!.votes, [
    { userId: 4, option: 0 },
    { userId: 4, option: 2 },
  ]);
  polls = ops.applyVote(polls, 1, 4, [2]);
  assert.deepEqual(polls[0]!.votes, [{ userId: 4, option: 2 }]);
  polls = ops.applyVote(polls, 1, 4, []);
  assert.deepEqual(polls[0]!.votes, []);
  polls = ops.applyVote(polls, 1, 4, [0, 2]);
  polls = ops.applyPollUpdate(polls, 1, 'Renamed', ['A', 'B', 'C'], true, 2_000);
  assert.deepEqual(polls[0]!.votes, [
    { userId: 4, option: 0 },
    { userId: 4, option: 2 },
  ]);
  polls = ops.applyPollUpdate(polls, 1, 'Renamed', ['C', 'A', 'B'], true, 3_000);
  assert.deepEqual(polls[0]!.votes, []);

  let announcements = [ann({ id: 1 })];
  announcements = ops.applyReact(announcements, 1, 4, '👍');
  announcements = ops.applyReact(announcements, 1, 4, '🔥');
  assert.deepEqual(announcements[0]!.reactions, [{ userId: 4, emoji: '🔥' }]);
  announcements = ops.applyReact(announcements, 1, 4, null);
  assert.deepEqual(announcements[0]!.reactions, []);
  const reordered = ops.applyReorder(
    [ann({ id: 1, sort: 0 }), ann({ id: 2, sort: 1 }), ann({ id: 3, sort: 2 })],
    [3, 1],
  );
  assert.deepEqual(
    reordered.map((a) => a.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    reordered.map((a) => a.sort),
    [0, 1, 2],
  );
  const created = ops.applyAnnCreate(
    [ann({ id: 1, sort: 0 })],
    -1,
    'new',
    'body',
    'en-US',
    123,
  )[1]!;
  assert.equal(created.id, -1);
  assert.equal(created.title, 'new');
  assert.equal(created.sort, 1);
  assert.equal(created.updatedAt, 123);

  let feedback: Feedback[] = [];
  feedback = ops.applyFbCreate(feedback, -1, 0, 'hi', 'en-US', 5);
  assert.deepEqual(feedback, [
    { id: -1, userId: 0, contentMd: 'hi', createdAt: 5, locale: 'en-US', sort: -1 },
  ]);
  feedback = ops.applyFbCreate(feedback, -2, 0, 'newer', 'en-US', 6);
  assert.deepEqual(
    feedback.map((f) => f.sort),
    [-2, -1],
  );
  assert.deepEqual(
    ops.applyFbDelete(feedback, -1).map((f) => f.id),
    [-2],
  );
});

test('frontend ops and filters: splits independent poll references from Markdown and counts reactions in set order', () => {
  assert.deepEqual(splitPollReferences('opening note\n::vote:0\nclosing note'), [
    { type: 'markdown', content: 'opening note' },
    { type: 'poll', id: 0 },
    { type: 'markdown', content: 'closing note' },
  ]);
  assert.deepEqual(splitPollReferences('::vote:12\n::vote:3'), [
    { type: 'poll', id: 12 },
    { type: 'poll', id: 3 },
  ]);
  assert.deepEqual(splitPollReferences('plain text'), [
    { type: 'markdown', content: 'plain text' },
  ]);
  assert.deepEqual(splitPollReferences(':::vote A | B'), [
    { type: 'markdown', content: ':::vote A | B' },
  ]);
  assert.deepEqual(
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
    [
      { emoji: '👍', count: 2, selfReacted: true },
      { emoji: '🔥', count: 1, selfReacted: false },
    ],
  );
  assert.deepEqual(reactionCounts(ann({ id: 1 }), 0), []);
});

test('frontend ops and filters: filters by type, ownership, marks, and ranges', () => {
  const photos = [
    photo({ id: 1, type: 0, uploader: 0, likes: [0], size: 10 }),
    photo({ id: 2, type: 1, uploader: 1, dislikes: [0], size: 20 }),
    photo({ id: 3, type: 2, uploader: 0, reports: [0], size: 30 }),
  ];
  assert.equal(metricOf(photos[0]!, 'heat'), 1);
  assert.equal(metricOf(photos[1]!, 'heat'), -1);
  assert.deepEqual(metricRange(photos, 'size'), [10, 30]);
  assert.equal(metricRange([], 'size'), null);
  const flat = [photo({ id: 1, likes: [1] }), photo({ id: 2, likes: [2] })];
  assert.equal(isFilterable(flat, 'likes'), false);
  assert.equal(isFilterable(photos, 'size'), true);

  const f = defaultFilterSettings();
  assert.equal(applyFilters(photos, f, 0).length, 3);
  f.types = new Set([0, 2]);
  f.ownedByMe = 'only';
  assert.deepEqual(
    applyFilters(photos, f, 0).map((p) => p.id),
    [1, 3],
  );
  f.ownedByMe = 'exclude';
  assert.deepEqual(applyFilters(photos, f, 0), []);
  const liked = defaultFilterSettings();
  liked.likedByMe = 'only';
  assert.deepEqual(
    applyFilters(photos, liked, 0).map((p) => p.id),
    [1],
  );
  liked.likedByMe = 'exclude';
  assert.deepEqual(
    applyFilters(photos, liked, 0).map((p) => p.id),
    [2, 3],
  );
  const reported = defaultFilterSettings();
  reported.reportedByMe = 'only';
  assert.deepEqual(
    applyFilters(photos, reported, 0).map((p) => p.id),
    [3],
  );
  const ranged = defaultFilterSettings();
  ranged.ranges = { size: [15, 25] };
  assert.deepEqual(
    applyFilters(photos, ranged, 0).map((p) => p.id),
    [2],
  );
  assert.equal(countActiveFilters(defaultFilterSettings()), 0);
  const counted = defaultFilterSettings();
  counted.types = new Set([0]);
  counted.likedByMe = 'only';
  counted.ranges = { size: [1, 2] };
  assert.equal(countActiveFilters(counted), 3);
});
