import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Feedback } from '$shared/types';
import { filterFeedback } from '../../src/routes/admin/feedbackView';

const feedback: Feedback[] = [
  { id: 10, userId: 2, contentMd: 'Improve **search**', createdAt: 1, locale: 'en-US', sort: 0 },
  {
    id: 11,
    userId: 20,
    contentMd: 'Please add image previews',
    createdAt: 2,
    locale: 'en-US',
    sort: 1,
  },
  { id: 12, userId: 3, contentMd: 'Faster exports', createdAt: 3, locale: 'zh-CN', sort: 2 },
];

const ids = (query: string): number[] => filterFeedback(feedback, query).map((item) => item.id);

test('searches content and ids, and copies the list for an empty query', () => {
  assert.deepEqual(ids('  SEARCH '), [10]);
  assert.deepEqual(ids('20'), [11]);
  assert.deepEqual(ids('12'), [12]);
  assert.deepEqual(ids('exports'), [12]);
  const result = filterFeedback(feedback, '  ');
  assert.deepEqual(result, feedback);
  assert.notEqual(result, feedback);
});
