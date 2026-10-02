import { test } from 'vitest';
import assert from 'node:assert/strict';
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
  locale: 'en-US',
  sort,
});

test('reorder: reports one moved order and renumbers without dropping row data', () => {
  const moved = finalizeReorder(moveReorderToIndex(beginReorder([1, 2, 3], 1), 3));
  assert.deepEqual(moved.orderedIds, [2, 3, 1]);
  assert.equal(finalizeReorder(moved.draft).orderedIds, null);
  assert.equal(finalizeReorder(beginReorder([1, 2], 1)).orderedIds, null);

  const out = applyReorder([feedback(10, 0), feedback(11, 1), feedback(12, 2)], [12, 10]);
  assert.deepEqual(
    out.map((f) => f.id),
    [12, 10, 11],
  );
  assert.deepEqual(
    out.map((f) => f.sort),
    [0, 1, 2],
  );
  const original = [feedback(1, 0), feedback(2, 1), feedback(3, 2)];
  const rolled = applyReorder(
    [{ ...original[2]!, contentMd: 'edited' }, original[0]!, original[1]!],
    [1, 2, 3],
  );
  assert.deepEqual(
    rolled.map((f) => f.id),
    [1, 2, 3],
  );
  assert.equal(rolled[2]!.contentMd, 'edited');
  assert.deepEqual(
    rolled.map((f) => f.sort),
    [0, 1, 2],
  );
});
