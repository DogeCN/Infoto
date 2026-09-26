// Shared settings and filter logic for the panel and main page.

import type { FillStrategy, ScrollDir } from '$base/lib/layout';
import { MEDIA_TYPE, type MediaType, type Photo } from '$shared/types';

/** Ownership filter states: off, include-only, or exclude-only. */
export type TriState = 'off' | 'only' | 'exclude';

/** Keys for the five numeric range filters. */
export type RangeKey = 'heat' | 'likes' | 'dislikes' | 'reports' | 'size';

export const RANGE_KEYS: readonly RangeKey[] = ['heat', 'likes', 'dislikes', 'reports', 'size'];
const MEDIA_TYPES = [MEDIA_TYPE.IMAGE, MEDIA_TYPE.ANIMATED, MEDIA_TYPE.VIDEO] as const;

export const RANGE_LABELS: Record<RangeKey, string> = {
  heat: '热度',
  likes: '喜欢数',
  dislikes: '不喜欢数',
  reports: '请求删除数',
  size: '文件大小',
};

/** The current interval for one range filter; absent means the full range. */
export type RangeValue = [number, number];

export interface FilterSettings {
  /** Selected media types; at least one remains selected. */
  types: Set<MediaType>;
  ownedByMe: TriState;
  likedByMe: TriState;
  dislikedByMe: TriState;
  reportedByMe: TriState;
  /** Stored range intervals; a missing key means the full range. */
  ranges: Partial<Record<RangeKey, RangeValue>>;
}

export interface LayoutSettings {
  dir: ScrollDir;
  strategy: FillStrategy;
  band: number;
  gap: number;
}

export interface Settings {
  filters: FilterSettings;
  layout: LayoutSettings;
}

/** Return a photo's value for one range dimension. */
export function metricOf(photo: Photo, key: RangeKey): number {
  switch (key) {
    case 'heat':
      return photo.likes.length - photo.dislikes.length;
    case 'likes':
      return photo.likes.length;
    case 'dislikes':
      return photo.dislikes.length;
    case 'reports':
      return photo.reports.length;
    case 'size':
      return photo.size;
  }
}

/** Return a dimension's dynamic [min, max] range, or null without photos. */
export function metricRange(photos: Photo[], key: RangeKey): RangeValue | null {
  if (photos.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of photos) {
    const v = metricOf(p, key);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** A dimension is filterable when it spans at least three integer values
 *  (max - min >= 2). A two-value domain like likes 0..1 has no meaningful
 *  sub-range — [min,max] selects everything and single values are not
 *  expressible — so the slider stays disabled instead of misbehaving. */
export function isFilterable(photos: Photo[], key: RangeKey): boolean {
  const r = metricRange(photos, key);
  return r !== null && r[1] - r[0] >= 2;
}

export function defaultFilterSettings(): FilterSettings {
  return {
    types: new Set(MEDIA_TYPES),
    ownedByMe: 'off',
    likedByMe: 'off',
    dislikedByMe: 'off',
    reportedByMe: 'off',
    ranges: {},
  };
}

export function defaultSettings(): Settings {
  return {
    filters: defaultFilterSettings(),
    layout: { dir: 'v', strategy: 'sequential', band: 260, gap: 12 },
  };
}

const TRI_STATES: readonly TriState[] = ['off', 'only', 'exclude'];

/**
 * Normalize persisted settings one field at a time and fall back to defaults
 * for invalid values.
 */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const src = raw as Record<string, unknown>;

  const rf = (src['filters'] ?? {}) as Record<string, unknown>;
  const types = new Set<MediaType>(
    Array.isArray(rf['types'])
      ? (rf['types'] as unknown[]).filter(
          (t): t is MediaType => typeof t === 'number' && MEDIA_TYPES.includes(t as MediaType),
        )
      : [],
  );
  if (types.size === 0) for (const t of d.filters.types) types.add(t);

  const tri = (v: unknown): TriState =>
    typeof v === 'string' && (TRI_STATES as readonly string[]).includes(v)
      ? (v as TriState)
      : 'off';

  const rawRanges = (rf['ranges'] ?? {}) as Record<string, unknown>;
  const ranges: Partial<Record<RangeKey, RangeValue>> = {};
  for (const key of RANGE_KEYS) {
    const v = rawRanges[key];
    if (!Array.isArray(v) || v.length !== 2) continue;
    const [a, b] = v as unknown[];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    ranges[key] = [Math.min(a, b), Math.max(a, b)];
  }

  const rl = (src['layout'] ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  return {
    filters: {
      types,
      ownedByMe: tri(rf['ownedByMe']),
      likedByMe: tri(rf['likedByMe']),
      dislikedByMe: tri(rf['dislikedByMe']),
      reportedByMe: tri(rf['reportedByMe']),
      ranges,
    },
    layout: {
      dir: rl['dir'] === 'h' ? 'h' : 'v',
      strategy: rl['strategy'] === 'shortest' ? 'shortest' : 'sequential',
      band: num(rl['band'], d.layout.band),
      gap: num(rl['gap'], d.layout.gap),
    },
  };
}

/** Apply all filters with AND semantics; absent ranges do not filter. */
export function applyFilters(photos: Photo[], f: FilterSettings, selfId: number): Photo[] {
  return photos.filter((p) => {
    if (!f.types.has(p.type)) return false;
    if (f.ownedByMe === 'only' && p.uploader !== selfId) return false;
    if (f.ownedByMe === 'exclude' && p.uploader === selfId) return false;
    if (f.likedByMe === 'only' && !p.likes.includes(selfId)) return false;
    if (f.likedByMe === 'exclude' && p.likes.includes(selfId)) return false;
    if (f.dislikedByMe === 'only' && !p.dislikes.includes(selfId)) return false;
    if (f.dislikedByMe === 'exclude' && p.dislikes.includes(selfId)) return false;
    if (f.reportedByMe === 'only' && !p.reports.includes(selfId)) return false;
    if (f.reportedByMe === 'exclude' && p.reports.includes(selfId)) return false;

    for (const key of RANGE_KEYS) {
      const range = f.ranges[key];
      if (!range) continue;
      const v = metricOf(p, key);
      if (v < range[0] || v > range[1]) return false;
    }
    return true;
  });
}

/** Count active filters for the top-bar badge. */
export function countActiveFilters(f: FilterSettings): number {
  let c = 0;
  if (f.types.size < 3) c++;
  if (f.ownedByMe !== 'off') c++;
  if (f.likedByMe !== 'off') c++;
  if (f.dislikedByMe !== 'off') c++;
  if (f.reportedByMe !== 'off') c++;
  for (const key of RANGE_KEYS) if (f.ranges[key]) c++;
  return c;
}
