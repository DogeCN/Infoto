import { copy, fmt } from '$shared/copy';

/** Compact relative time ("just now" / "N minutes ago" … "N years ago") against
 *  an optional reference so tests (and stale renders) stay deterministic. */
export function formatRelativeTime(timestamp: number, reference: number = Date.now()): string {
  const elapsed = Math.max(0, reference - timestamp);
  if (elapsed < 60_000) return copy.time.justNow;
  if (elapsed < 3_600_000) return fmt(copy.time.minutesAgo, { n: Math.floor(elapsed / 60_000) });
  if (elapsed < 86_400_000) return fmt(copy.time.hoursAgo, { n: Math.floor(elapsed / 3_600_000) });
  const days = Math.floor(elapsed / 86_400_000);
  if (days < 30) return fmt(copy.time.daysAgo, { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return fmt(copy.time.monthsAgo, { n: months });
  return fmt(copy.time.yearsAgo, { n: Math.floor(months / 12) });
}

/** Absolute time with leading components dropped: same day → "HH:MM", same year →
 *  date + clock (locale-formatted month/day), else with the year. Keys on calendar
 *  boundaries so yesterday keeps its date; `reference` defaults to now. */
export function formatSmartAbsolute(timestamp: number, reference: number = Date.now()): string {
  const d = new Date(timestamp);
  const r = new Date(reference);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === r.getFullYear() &&
    d.getMonth() === r.getMonth() &&
    d.getDate() === r.getDate();
  if (sameDay) return clock;
  const monthDay = fmt(copy.time.monthDay, {
    month: d.getMonth() + 1,
    day: d.getDate(),
    clock,
  });
  if (d.getFullYear() === r.getFullYear()) return monthDay;
  return fmt(copy.time.yearMonthDay, { year: d.getFullYear(), monthDay });
}
