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

describe('reorder', () => {
  it('reports one moved order and renumbers without dropping row data', () => {
    const moved = finalizeReorder(moveReorderToIndex(beginReorder([1, 2, 3], 1), 3));
    expect(moved.orderedIds).toEqual([2, 3, 1]);
    expect(finalizeReorder(moved.draft).orderedIds).toBeNull();
    expect(finalizeReorder(beginReorder([1, 2], 1)).orderedIds).toBeNull();

    const out = applyReorder([feedback(10, 0), feedback(11, 1), feedback(12, 2)], [12, 10]);
    expect(out.map((f) => f.id)).toEqual([12, 10, 11]);
    expect(out.map((f) => f.sort)).toEqual([0, 1, 2]);
    const original = [feedback(1, 0), feedback(2, 1), feedback(3, 2)];
    const rolled = applyReorder(
      [{ ...original[2]!, contentMd: 'edited' }, original[0]!, original[1]!],
      [1, 2, 3],
    );
    expect(rolled.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(rolled[2]!.contentMd).toBe('edited');
    expect(rolled.map((f) => f.sort)).toEqual([0, 1, 2]);
  });
});
