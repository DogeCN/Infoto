import { describe, expect, it } from 'vitest';
import type { Announcement } from '$shared/types';
import {
  beginAnnouncementReorder,
  finalizeAnnouncementReorder,
  markAnnouncementPending,
  moveAnnouncementReorder,
  reconcileAnnouncementPending,
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
  it('moves locally and emits one full-ID op at finalization', () => {
    let draft = beginAnnouncementReorder([1, 2, 3], 1);
    draft = moveAnnouncementReorder(draft, 3);
    const first = finalizeAnnouncementReorder(draft);
    const second = finalizeAnnouncementReorder(first.draft);

    expect(first.op).toEqual({ type: 'ann_reorder', payload: [2, 3, 1] });
    expect(second.op).toBeNull();
  });

  it('does not emit when the draft did not move', () => {
    const draft = beginAnnouncementReorder([1, 2], 1);
    expect(finalizeAnnouncementReorder(draft).op).toBeNull();
  });
});

describe('announcement pending reconciliation', () => {
  it('confirms only IDs present in the next snapshot', () => {
    const pending = markAnnouncementPending([], [5, 6], 1, true);
    const result = reconcileAnnouncementPending(pending, new Set([5]), new Map(), 2);

    expect([...result.confirmedIds]).toEqual([5]);
    expect([...result.pendingIds]).toEqual([6]);
    expect(result.mutations).toEqual([{ ids: [6], queuedAtAttempt: 1, reorder: true }]);
  });

  it('retains mutations queued during the in-flight snapshot attempt', () => {
    const pending = markAnnouncementPending([], [5], 3);
    const result = reconcileAnnouncementPending(pending, new Set([5]), new Map(), 3);

    expect(result.confirmedIds.size).toBe(0);
    expect([...result.pendingIds]).toEqual([5]);
    expect(result.mutations).toHaveLength(1);
  });

  it('remaps a confirmed temporary create through the existing mapping', () => {
    const pending = markAnnouncementPending([], [-1], 1);
    const result = reconcileAnnouncementPending(
      pending,
      new Set([7]),
      new Map([[-1, 7]]),
      2,
    );

    expect([...result.confirmedIds]).toEqual([7]);
    expect(result.pendingIds.size).toBe(0);
    expect(result.mutations).toEqual([]);
  });
});

describe('announcement reorder rollback', () => {
  it('restores the previous order without discarding current card data', () => {
    const original = [announcement(1, 0), announcement(2, 1), announcement(3, 2)];
    const reordered = [
      { ...original[2]!, title: 'updated' },
      original[0]!,
      original[1]!,
    ];
    const rolledBack = rollbackAnnouncementOrder(reordered, [1, 2, 3]);

    expect(rolledBack.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(rolledBack[2]!.title).toBe('updated');
    expect(rolledBack.map((item) => item.sort)).toEqual([0, 1, 2]);
  });
});
