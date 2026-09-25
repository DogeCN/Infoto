import { describe, expect, it } from 'vitest';
import {
  constrainNormalizedRange,
  mapRangeValue,
  normalizeRangeValue,
  normalizedRangeGap,
  stepRangePositionByValue,
} from '../../src/lib/components/rangeScale';

describe('range scale helpers', () => {
  it('maps linear normalized positions to integer values', () => {
    expect(normalizeRangeValue(25, 0, 100, 'linear')).toBe(0.25);
    expect(mapRangeValue(0.25, 0, 100, 'linear')).toBe(25);
    expect(mapRangeValue(1 / 3, -10, 10, 'linear')).toBe(-3);
  });

  it('maps file-size positions logarithmically with safe zero handling', () => {
    expect(normalizeRangeValue(0, 0, 1_000_000, 'logarithmic')).toBe(0);
    expect(mapRangeValue(0, 0, 1_000_000, 'logarithmic')).toBe(0);
    expect(mapRangeValue(0.5, 0, 1_000_000, 'logarithmic')).toBe(999);
    const position = normalizeRangeValue(1, 0, 1_000_000, 'logarithmic');
    expect(mapRangeValue(position, 0, 1_000_000, 'logarithmic')).toBe(1);
  });

  it('keeps mappings ordered and integral', () => {
    let previous = -Infinity;
    for (let position = 0; position <= 1; position += 0.01) {
      const value = mapRangeValue(position, 0, 10_000_000, 'logarithmic');
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('handles an equal domain without NaN', () => {
    expect(normalizeRangeValue(1, 42, 42, 'logarithmic')).toBe(0);
    expect(mapRangeValue(0.75, 42, 42, 'logarithmic')).toBe(42);
    expect(normalizedRangeGap(42, 42, 'logarithmic', 0.2)).toBe(0.2);
  });

  it('uses one mapped business unit for keyboard movement', () => {
    const next = stepRangePositionByValue(0, 0, 1_000_000, 'logarithmic', 1);
    expect(mapRangeValue(next, 0, 1_000_000, 'logarithmic')).toBe(1);

    const previous = stepRangePositionByValue(next, 0, 1_000_000, 'logarithmic', -1);
    expect(mapRangeValue(previous, 0, 1_000_000, 'logarithmic')).toBe(0);
  });

  it('enforces visual and one-unit normalized separation', () => {
    const oneByte = normalizedRangeGap(0, 1_000_000, 'logarithmic', 0.01);
    expect(oneByte).toBeGreaterThan(0);
    expect(constrainNormalizedRange(0.9, 0.91, oneByte, 'hi')[1] - 0.9).toBeCloseTo(oneByte);
  });
});
