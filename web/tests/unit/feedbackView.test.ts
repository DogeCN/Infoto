import { describe, expect, it } from 'vitest';
import type { Feedback } from '$shared/types';
import { filterFeedback } from '../../src/routes/admin/feedbackView';

const feedback: Feedback[] = [
  { id: 10, userId: 2, contentMd: 'Improve **search**', createdAt: 1 },
  { id: 11, userId: 20, contentMd: 'Please add image previews', createdAt: 2 },
  { id: 12, userId: 3, contentMd: '导出更快', createdAt: 3 },
];

describe('admin feedback view', () => {
  it('searches content, user IDs, and feedback IDs case-insensitively', () => {
    expect(filterFeedback(feedback, '  SEARCH ').map((item) => item.id)).toEqual([10]);
    expect(filterFeedback(feedback, '20').map((item) => item.id)).toEqual([11]);
    expect(filterFeedback(feedback, '12').map((item) => item.id)).toEqual([12]);
    expect(filterFeedback(feedback, '导出').map((item) => item.id)).toEqual([12]);
  });

  it('returns a copy for an empty query', () => {
    const result = filterFeedback(feedback, '  ');
    expect(result).toEqual(feedback);
    expect(result).not.toBe(feedback);
  });
});
