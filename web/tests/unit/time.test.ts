import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/lib/i18n.svelte';
import { formatRelativeTime, formatSmartAbsolute } from '../../src/lib/time';

const reference = Date.UTC(2026, 8, 25, 12, 0, 0);

beforeEach(() => setLocale('en-US'));

describe('time labels', () => {
  it('formats relative time and follows the active locale', () => {
    expect(formatRelativeTime(reference, reference - 59_999)).toBe('Just now');
    expect(formatRelativeTime(reference - 60_000, reference)).toBe('1 minute ago');
    expect(formatRelativeTime(reference - 3_600_000, reference)).toBe('1 hour ago');
    expect(formatRelativeTime(reference - 86_400_000, reference)).toBe('1 day ago');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 days ago');
    expect(formatRelativeTime(reference - 45 * 86_400_000, reference)).toBe('1 month ago');
    expect(formatRelativeTime(reference - 400 * 86_400_000, reference)).toBe('1 year ago');
    expect(formatRelativeTime(reference + 60_000, reference)).toBe('Just now');
    setLocale('zh-CN');
    expect(formatRelativeTime(reference, reference - 59_999)).toBe('刚刚');
    expect(formatRelativeTime(reference - 60_000, reference)).toBe('1 分钟前');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 天前');
    setLocale('en-US');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 days ago');
  });

  it('drops date parts that the moment shares with now', () => {
    const now = new Date(2026, 8, 26, 14, 30).getTime();
    expect(formatSmartAbsolute(new Date(2026, 8, 26, 6, 5).getTime(), now)).toBe('06:05');
    expect(formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now)).toBe('9/24 14:30');
    expect(formatSmartAbsolute(new Date(2026, 8, 25, 23, 55).getTime(), now)).toBe('9/25 23:55');
    const full = formatSmartAbsolute(new Date(2025, 11, 31, 23, 59).getTime(), now);
    expect(full).toBe('2025/12/31 23:59');
    expect(full).not.toContain('-');
    setLocale('zh-CN');
    expect(formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now)).toBe('9月24日 14:30');
    setLocale('en-US');
  });
});
