import { describe, expect, it } from 'vitest';
import { mapRangeValue, normalizeRangeValue } from '../../src/lib/components/rangeScale';

describe('range scale helpers', () => {
  it('maps linear and logarithmic positions without NaN', () => {
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
  });
});
