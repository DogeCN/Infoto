// Shared settings and filter logic for the panel and main page.

import type { FillStrategy, ScrollDir } from '$base/lib/layout';
import { MEDIA_TYPE, type MediaType, type Photo } from '$shared/types';

/** Ownership filter states: off, include-only, or exclude-only. */
export type TriState = 'off' | 'only' | 'exclude';

/** Keys for the five numeric range filters. */
export type RangeKey = 'heat' | 'likes' | 'dislikes' | 'reports' | 'size';

export const RANGE_KEYS: readonly RangeKey[] = ['heat', 'likes', 'dislikes', 'reports', 'size'];
const MEDIA_TYPES = [MEDIA_TYPE.IMAGE, MEDIA_TYPE.ANIMATED, MEDIA_TYPE.VIDEO] as const;

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
 * (max - min >= 2): a two-value domain has no meaningful sub-range, so the slider
 * stays disabled instead of misbehaving. */
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
    layout: { dir: 'v', strategy: 'shortest', band: 260, gap: 12 },
  };
}

const STORAGE_KEY = 'infoto-settings';

/** Bump whenever the persisted shape changes: a blob written by any other version
 * is dropped wholesale and replaced by defaults — there is deliberately no
 * per-field migration; the version tag is the guard. */
const SETTINGS_VERSION = 1;

/** Persisted shape: a `Set` is not JSON-serializable, so media types are stored as an array. */
interface StoredSettings {
  v: number;
  filters: Omit<FilterSettings, 'types'> & { types: MediaType[] };
  layout: LayoutSettings;
}

/** Read persisted settings. An untagged, mangled or unreadable blob resets to defaults. */
export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): Settings {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultSettings(); // storage blocked (private mode / disabled cookies)
  }
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    if (parsed.v !== SETTINGS_VERSION || !parsed.filters || !parsed.layout) {
      return defaultSettings();
    }
    return {
      filters: { ...parsed.filters, types: new Set(parsed.filters.types) },
      layout: parsed.layout,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  const stored: StoredSettings = {
    v: SETTINGS_VERSION,
    filters: { ...s.filters, types: [...s.filters.types] },
    layout: s.layout,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked or full: the panel still applies in memory for this session.
  }
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
