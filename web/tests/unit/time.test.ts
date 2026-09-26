import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatSmartAbsolute } from '../../src/lib/time';

const reference = Date.UTC(2026, 8, 25, 12, 0, 0);

describe('announcement time formatting', () => {
  it('formats concise relative time against the supplied reference', () => {
    expect(formatRelativeTime(reference, reference - 59_999)).toBe('刚刚');
    expect(formatRelativeTime(reference - 60_000, reference)).toBe('1 分钟前');
    expect(formatRelativeTime(reference - 3_600_000, reference)).toBe('1 小时前');
    expect(formatRelativeTime(reference - 86_400_000, reference)).toBe('1 天前');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 天前');
    expect(formatRelativeTime(reference - 45 * 86_400_000, reference)).toBe('1 个月前');
    expect(formatRelativeTime(reference - 400 * 86_400_000, reference)).toBe('1 年前');
  });

  it('clamps a future timestamp to the reference', () => {
    expect(formatRelativeTime(reference + 60_000, reference)).toBe('刚刚');
  });
});

describe('formatSmartAbsolute', () => {
  // Built from local components so the ladder never depends on the runner's time zone.
  const now = new Date(2026, 8, 26, 14, 30).getTime();

  it('drops the whole date for a same-day moment', () => {
    expect(formatSmartAbsolute(new Date(2026, 8, 26, 6, 5).getTime(), now)).toBe('06:05');
  });

  it('drops only the year for another day in the same year', () => {
    expect(formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now)).toBe('9月24日 14:30');
  });

  it('keeps the full date across years with Chinese units, never slashes or dashes', () => {
    const out = formatSmartAbsolute(new Date(2025, 11, 31, 23, 59).getTime(), now);
    expect(out).toBe('2025年12月31日 23:59');
    expect(out).not.toContain('/');
    expect(out).not.toContain('-');
  });

  it('keeps the date when the elapsed time is short but the day differs', () => {
    // 35 minutes earlier yet yesterday: a bare "23:55" would read as today.
    expect(formatSmartAbsolute(new Date(2026, 8, 25, 23, 55).getTime(), now)).toBe('9月25日 23:55');
  });
});
