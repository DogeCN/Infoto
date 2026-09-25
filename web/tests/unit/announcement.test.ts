import { describe, expect, it } from 'vitest';
import type { Announcement } from '$shared/types';
import {
  beginAnnouncementReorder,
  finalizeAnnouncementReorder,
  moveAnnouncementReorderToIndex,
  rollbackAnnouncementOrder,
} from '../../src/core/ops';

const announcement = (id: number, sort: number, title = `ann-${id}`): Announcement => ({
  id,
  title,
  contentMd: 'body',
  sort,
  updatedAt: id,
  reactions: [],
  votes: [],
});

describe('announcement reorder draft', () => {
  it('moves locally and reports one full-ID order at finalization', () => {
    let draft = beginAnnouncementReorder([1, 2, 3], 1);
    draft = moveAnnouncementReorderToIndex(draft, 3);
    const first = finalizeAnnouncementReorder(draft);
    const second = finalizeAnnouncementReorder(first.draft);

    expect(first.orderedIds).toEqual([2, 3, 1]);
    expect(second.orderedIds).toBeNull();
  });

  it('does not report an order when the draft did not move', () => {
    const draft = beginAnnouncementReorder([1, 2], 1);
    expect(finalizeAnnouncementReorder(draft).orderedIds).toBeNull();
  });
});

describe('announcement reorder rollback', () => {
  it('restores the previous order without discarding current card data', () => {
    const original = [announcement(1, 0), announcement(2, 1), announcement(3, 2)];
    const reordered = [{ ...original[2]!, title: 'updated' }, original[0]!, original[1]!];
    const rolledBack = rollbackAnnouncementOrder(reordered, [1, 2, 3]);

    expect(rolledBack.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(rolledBack[2]!.title).toBe('updated');
    expect(rolledBack.map((item) => item.sort)).toEqual([0, 1, 2]);
  });
});
