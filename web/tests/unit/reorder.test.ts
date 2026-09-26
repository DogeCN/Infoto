import { describe, expect, it } from 'vitest';
import type { Feedback } from '$shared/types';
import {
  applyReorder,
  beginReorder,
  finalizeReorder,
  moveReorderToIndex,
} from '../../src/core/ops';

const feedback = (id: number, sort: number, contentMd = `fb-${id}`): Feedback => ({
  id,
  userId: 0,
  contentMd,
  createdAt: id,
  sort,
});

describe('reorder draft', () => {
  it('moves locally and reports one full-ID order at finalization', () => {
    let draft = beginReorder([1, 2, 3], 1);
    draft = moveReorderToIndex(draft, 3);
    const first = finalizeReorder(draft);
    const second = finalizeReorder(first.draft);

    expect(first.orderedIds).toEqual([2, 3, 1]);
    expect(second.orderedIds).toBeNull();
  });

  it('does not report an order when the draft did not move', () => {
    const draft = beginReorder([1, 2], 1);
    expect(finalizeReorder(draft).orderedIds).toBeNull();
  });
});

describe('applyReorder', () => {
  it('appends ids the order did not mention and renumbers sort to 0…n-1', () => {
    const out = applyReorder([feedback(10, 0), feedback(11, 1), feedback(12, 2)], [12, 10]);
    expect(out.map((f) => f.id)).toEqual([12, 10, 11]);
    expect(out.map((f) => f.sort)).toEqual([0, 1, 2]);
  });

  it('restores a previous order without discarding current row data', () => {
    const original = [feedback(1, 0), feedback(2, 1), feedback(3, 2)];
    const reordered = [{ ...original[2]!, contentMd: 'edited' }, original[0]!, original[1]!];
    const rolledBack = applyReorder(reordered, [1, 2, 3]);

    expect(rolledBack.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(rolledBack[2]!.contentMd).toBe('edited');
    expect(rolledBack.map((f) => f.sort)).toEqual([0, 1, 2]);
  });
});
