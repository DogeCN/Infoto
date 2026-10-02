import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mapRangeValue, normalizeRangeValue } from '../../src/base/lib/slider';

test('range scale helpers: maps slider values, thumb geometry, and pointer limits', async () => {
  // Maps linear and logarithmic positions without NaN.
  {
    assert.equal(normalizeRangeValue(25, 0, 100, 'linear'), 0.25);
    assert.equal(mapRangeValue(0.25, 0, 100, 'linear'), 25);
    assert.equal(mapRangeValue(1 / 3, -10, 10, 'linear'), -3);
    assert.equal(normalizeRangeValue(0, 0, 1_000_000, 'logarithmic'), 0);
    assert.equal(mapRangeValue(0, 0, 1_000_000, 'logarithmic'), 0);
    assert.equal(mapRangeValue(0.5, 0, 1_000_000, 'logarithmic'), 999);
    const position = normalizeRangeValue(1, 0, 1_000_000, 'logarithmic');
    assert.equal(mapRangeValue(position, 0, 1_000_000, 'logarithmic'), 1);
    assert.equal(normalizeRangeValue(1, 42, 42, 'logarithmic'), 0);
    assert.equal(mapRangeValue(0.75, 42, 42, 'logarithmic'), 42);
    let previous = -Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      const value = mapRangeValue(t, 0, 10_000_000, 'logarithmic');
      assert.equal(Number.isInteger(value), true);
      assert.ok(value >= previous);
      previous = value;
    }
  }

  // Shares thumb geometry and clamps pointer positions.
  {
    const { bubblePosition, pointerPosition, stepValue } =
      await import('../../src/base/lib/slider');
    assert.deepEqual(bubblePosition(0, 60, 200), { left: 0, tip: 9 });
    assert.deepEqual(bubblePosition(1, 60, 200), { left: 140, tip: 51 });
    assert.equal(pointerPosition(-100, { left: 0, width: 200 }), 0);
    assert.equal(pointerPosition(300, { left: 0, width: 200 }), 1);
    assert.equal(stepValue(0, 3, 13, 2), 3);
    assert.equal(stepValue(0.4, 3, 13, 2), 7);
    assert.equal(stepValue(1, 3, 13, 2), 13);
  }
});
