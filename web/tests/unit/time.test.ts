import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime } from '../../src/lib/time';

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

  it('formats deterministic absolute time with an explicit time zone', () => {
    expect(formatAbsoluteTime(reference, { timeZone: 'UTC' })).toBe(
      new Date(reference).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }),
    );
  });
});
