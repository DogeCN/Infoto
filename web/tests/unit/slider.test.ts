import { describe, expect, it } from 'vitest';
import { mapRangeValue, normalizeRangeValue } from '../../src/base/lib/slider';

describe('range scale helpers', () => {
  it('maps slider values, thumb geometry, and pointer limits', async () => {
    // Maps linear and logarithmic positions without NaN.
    {
      expect(normalizeRangeValue(25, 0, 100, 'linear')).toBe(0.25);
      expect(mapRangeValue(0.25, 0, 100, 'linear')).toBe(25);
      expect(mapRangeValue(1 / 3, -10, 10, 'linear')).toBe(-3);
      expect(normalizeRangeValue(0, 0, 1_000_000, 'logarithmic')).toBe(0);
      expect(mapRangeValue(0, 0, 1_000_000, 'logarithmic')).toBe(0);
      expect(mapRangeValue(0.5, 0, 1_000_000, 'logarithmic')).toBe(999);
      const position = normalizeRangeValue(1, 0, 1_000_000, 'logarithmic');
      expect(mapRangeValue(position, 0, 1_000_000, 'logarithmic')).toBe(1);
      expect(normalizeRangeValue(1, 42, 42, 'logarithmic')).toBe(0);
      expect(mapRangeValue(0.75, 42, 42, 'logarithmic')).toBe(42);
      let previous = -Infinity;
      for (let t = 0; t <= 1; t += 0.01) {
        const value = mapRangeValue(t, 0, 10_000_000, 'logarithmic');
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }

    // Shares thumb geometry and clamps pointer positions.
    {
      const { bubblePosition, pointerPosition, stepValue } =
        await import('../../src/base/lib/slider');
      expect(bubblePosition(0, 60, 200)).toEqual({ left: 0, tip: 9 });
      expect(bubblePosition(1, 60, 200)).toEqual({ left: 140, tip: 51 });
      expect(pointerPosition(-100, { left: 0, width: 200 })).toBe(0);
      expect(pointerPosition(300, { left: 0, width: 200 })).toBe(1);
      expect(stepValue(0, 3, 13, 2)).toBe(3);
      expect(stepValue(0.4, 3, 13, 2)).toBe(7);
      expect(stepValue(1, 3, 13, 2)).toBe(13);
    }
  });
});
