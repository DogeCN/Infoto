import {
  activeLocale,
  locales,
  fmt,
  plural,
  type PluralMessage,
  type LocaleCode,
} from '$shared/copy';

/** Fill the plural form for one relative-time unit in the active locale. */
function unit(forms: PluralMessage, n: number, locale: LocaleCode): string {
  return fmt(plural(n, forms, locale), { n });
}

/** Compact relative time ("just now" / "N minutes ago" … "N years ago") against
 *  an optional reference so tests (and stale renders) stay deterministic. */
export function formatRelativeTime(
  timestamp: number,
  reference: number = Date.now(),
  locale: LocaleCode = activeLocale(),
): string {
  const elapsed = Math.max(0, reference - timestamp);
  if (elapsed < 60_000) return locales[locale].time.justNow;
  if (elapsed < 3_600_000)
    return unit(locales[locale].time.minutesAgo, Math.floor(elapsed / 60_000), locale);
  if (elapsed < 86_400_000)
    return unit(locales[locale].time.hoursAgo, Math.floor(elapsed / 3_600_000), locale);
  const days = Math.floor(elapsed / 86_400_000);
  if (days < 30) return unit(locales[locale].time.daysAgo, days, locale);
  const months = Math.floor(days / 30);
  if (months < 12) return unit(locales[locale].time.monthsAgo, months, locale);
  return unit(locales[locale].time.yearsAgo, Math.floor(months / 12), locale);
}

/** Absolute time omitting the date on the same day and the year within the same calendar year. */
export function formatSmartAbsolute(
  timestamp: number,
  reference: number = Date.now(),
  locale: LocaleCode = activeLocale(),
): string {
  const d = new Date(timestamp);
  const r = new Date(reference);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === r.getFullYear() &&
    d.getMonth() === r.getMonth() &&
    d.getDate() === r.getDate();
  if (sameDay) return clock;
  const monthDay = fmt(locales[locale].time.monthDay, {
    month: d.getMonth() + 1,
    day: d.getDate(),
    clock,
  });
  if (d.getFullYear() === r.getFullYear()) return monthDay;
  return fmt(locales[locale].time.yearMonthDay, { year: d.getFullYear(), monthDay });
}

// Pure formatting helpers — human-readable byte sizes and zero-padded
// zip-entry names.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Human-readable size, binary steps of 1024 — e.g. 1825361101 -> "1.7 GB".
 *  Bytes render as integers; larger units keep one decimal (".0" dropped). */
export function humanSize(bytes: number): string {
  const { value, unit } = sizeParts(bytes);
  return `${unit === 0 ? Math.round(value) : Math.round(value * 10) / 10} ${UNITS[unit]}`;
}

function sizeParts(bytes: number): { value: number; unit: number } {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return { value, unit };
}

/** Compact byte size for fixed-width slider labels. */
export function compactSize(bytes: number): string {
  let { value, unit } = sizeParts(bytes);
  if (Math.round(value * 10) / 10 >= 1000 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${text} ${UNITS[unit]}`;
}

/** Zip entry name for the k-th file (0-based) out of `total`: current sort order
 *  index, zero-padded to the digit count of `total` (20 files -> "01"…"20").
 *  Extension decided by media type (0 -> webp). */
export function padName(k: number, total: number, ext: string): string {
  const width = String(Math.max(1, Math.floor(total))).length;
  return `${String(k + 1).padStart(width, '0')}.${ext}`;
}
