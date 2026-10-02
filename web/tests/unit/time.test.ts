import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { fmt, locales } from '../../../src/shared/copy';
import { setLocale } from '../../src/lib/i18n.svelte';
import { formatRelativeTime, formatSmartAbsolute } from '../../src/base/lib/format';

const reference = Date.UTC(2026, 8, 25, 12, 0, 0);

beforeEach(() => setLocale('en-US'));

test('time labels: formats relative and absolute time in the active locale', () => {
  // Formats relative time and follows the active locale.
  {
    assert.equal(formatRelativeTime(reference, reference - 59_999), 'Just now');
    assert.equal(formatRelativeTime(reference - 60_000, reference), '1 minute ago');
    assert.equal(formatRelativeTime(reference - 3_600_000, reference), '1 hour ago');
    assert.equal(formatRelativeTime(reference - 86_400_000, reference), '1 day ago');
    assert.equal(formatRelativeTime(reference - 8 * 86_400_000, reference), '8 days ago');
    assert.equal(formatRelativeTime(reference - 45 * 86_400_000, reference), '1 month ago');
    assert.equal(formatRelativeTime(reference - 400 * 86_400_000, reference), '1 year ago');
    assert.equal(formatRelativeTime(reference + 60_000, reference), 'Just now');
    setLocale('zh-CN');
    const zhTime = locales['zh-CN'].time;
    assert.equal(formatRelativeTime(reference, reference - 59_999), zhTime.justNow);
    assert.equal(
      formatRelativeTime(reference - 60_000, reference),
      fmt(zhTime.minutesAgo.other, { n: 1 }),
    );
    assert.equal(
      formatRelativeTime(reference - 8 * 86_400_000, reference),
      fmt(zhTime.daysAgo.other, { n: 8 }),
    );
    setLocale('en-US');
    assert.equal(formatRelativeTime(reference - 8 * 86_400_000, reference), '8 days ago');
  }

  // Drops date parts that the moment shares with now.
  {
    const now = new Date(2026, 8, 26, 14, 30).getTime();
    assert.equal(formatSmartAbsolute(new Date(2026, 8, 26, 6, 5).getTime(), now), '06:05');
    assert.equal(formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now), '9/24 14:30');
    assert.equal(formatSmartAbsolute(new Date(2026, 8, 25, 23, 55).getTime(), now), '9/25 23:55');
    const full = formatSmartAbsolute(new Date(2025, 11, 31, 23, 59).getTime(), now);
    assert.equal(full, '2025/12/31 23:59');
    assert.ok(!full.includes('-'));
    setLocale('zh-CN');
    assert.equal(
      formatSmartAbsolute(new Date(2026, 8, 24, 14, 30).getTime(), now),
      fmt(locales['zh-CN'].time.monthDay, { month: 9, day: 24, clock: '14:30' }),
    );
    setLocale('en-US');
  }
});
