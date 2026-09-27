import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/lib/i18n.svelte';
import { formatRelativeTime, formatSmartAbsolute } from '../../src/lib/time';

const reference = Date.UTC(2026, 8, 25, 12, 0, 0);

// The starting locale comes from `navigator.languages`, which in Node is the runner's
// ICU default — so pin it rather than let the machine decide the expectations.
beforeEach(() => setLocale('en-US'));

describe('announcement time formatting', () => {
  it('formats concise relative time against the supplied reference', () => {
    expect(formatRelativeTime(reference, reference - 59_999)).toBe('Just now');
    expect(formatRelativeTime(reference - 60_000, reference)).toBe('1 minute ago');
    expect(formatRelativeTime(reference - 3_600_000, reference)).toBe('1 hour ago');
    expect(formatRelativeTime(reference - 86_400_000, reference)).toBe('1 day ago');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 days ago');
    expect(formatRelativeTime(reference - 45 * 86_400_000, reference)).toBe('1 month ago');
    expect(formatRelativeTime(reference - 400 * 86_400_000, reference)).toBe('1 year ago');
  });

  it('clamps a future timestamp to the reference', () => {
    expect(formatRelativeTime(reference + 60_000, reference)).toBe('Just now');
  });

  it('re-formats immediately when the locale changes mid-session', () => {
    setLocale('zh-CN');
    expect(formatRelativeTime(reference, reference - 59_999)).toBe('刚刚');
    // Chinese has no plural categories, so one and many share a form.
    expect(formatRelativeTime(reference - 60_000, reference)).toBe('1 分钟前');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 天前');
    setLocale('en-US');
    expect(formatRelativeTime(reference - 8 * 86_400_000, reference)).toBe('8 days ago');
  });

  it('switches the absolute-time patterns too, not just the relative ones', () => {
    const stamp = new Date(2026, 8, 24, 14, 30).getTime();
    const now = new Date(2026, 8, 26, 14, 30).getTime();
    setLocale('zh-CN');
    expect(formatSmartAbsolute(stamp, now)).toBe('9月24日 14:30');
    setLocale('en-US');
    expect(formatSmartAbsolute(stamp, now)).toBe('9/24 14:30');
  });
});

describe('formatSmartAbsolute', () => {
  // Built from local components so the ladder never depends on the runner's time zone.
  const now = new Date(2026, 8, 26, 14, 30).getTime();

  it('drops the whole date for a same-day moment', () => {
    expect(formatSmartAbsolute(new Date(2026, 8, 26, 6, 5).getTime(), now)).toBe('06:05');
  });

  it('drops only the year for another day in the same year', () => {
    expect(formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now)).toBe('9/24 14:30');
  });

  it('keeps the full date across years', () => {
    const out = formatSmartAbsolute(new Date(2025, 11, 31, 23, 59).getTime(), now);
    expect(out).toBe('2025/12/31 23:59');
    expect(out).not.toContain('-');
  });

  it('keeps the date when the elapsed time is short but the day differs', () => {
    // 35 minutes earlier yet yesterday: a bare "23:55" would read as today.
    expect(formatSmartAbsolute(new Date(2026, 8, 25, 23, 55).getTime(), now)).toBe('9/25 23:55');
  });
});
