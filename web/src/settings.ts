// Shared settings and filter logic for the panel and main page.

import type { FillStrategy, ScrollDir } from '$base/lib/layout';
import { MAX_BAND, MIN_BAND } from '$base/lib/band';
import { clamp } from '$base/lib/num';
import { heat } from './core/gallery';
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
  /** Target row height / column width in CSS pixels; null follows the measured canvas (`autoBand`). */
  band: number | null;
  gap: number;
}

export interface Settings {
  filters: FilterSettings;
  layout: LayoutSettings;
  playback: PlaybackSettings;
}

/** Playback preferences; the level videos play at, independent of each element's mute state. */
export interface PlaybackSettings {
  /** 0…1; the `<video>` volume property, never a mute toggle. */
  volume: number;
}

/** Return a photo's value for one range dimension. */
export function metricOf(photo: Photo, key: RangeKey): number {
  switch (key) {
    case 'heat':
      return heat(photo);
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
    layout: { dir: 'v', strategy: 'shortest', band: null, gap: 12 },
    playback: { volume: 1 },
  };
}

const STORAGE_KEY = 'infoto-settings';

/** Persisted settings schema version. Other versions reset to defaults. */
const SETTINGS_VERSION = 5;

/** Persisted shape: a `Set` is not JSON-serializable, so media types are stored as an array. */
interface StoredSettings {
  v: number;
  filters: Omit<FilterSettings, 'types'> & { types: MediaType[] };
  layout: LayoutSettings;
  playback: PlaybackSettings;
}

/** Read and validate the complete stored shape; invalid settings reset to defaults. */
export function loadSettings(storage?: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as StoredSettings;
    if (!validStoredSettings(parsed)) return defaultSettings();
    return {
      filters: { ...parsed.filters, types: new Set(parsed.filters.types) },
      layout: {
        ...parsed.layout,
        band: parsed.layout.band === null ? null : clamp(parsed.layout.band, MIN_BAND, MAX_BAND),
        gap: clamp(parsed.layout.gap, 0, 32),
      },
      playback: { volume: clamp(parsed.playback.volume, 0, 1) },
    };
  } catch {
    return defaultSettings();
  }
}

function validStoredSettings(value: StoredSettings): boolean {
  if (!value || value.v !== SETTINGS_VERSION || !value.filters || !value.layout || !value.playback)
    return false;
  const { filters, layout, playback } = value;
  if (!Number.isFinite(playback.volume)) return false;
  if (
    !['v', 'h'].includes(layout.dir) ||
    !['sequential', 'shortest'].includes(layout.strategy) ||
    !(layout.band === null || Number.isFinite(layout.band)) ||
    !Number.isFinite(layout.gap)
  )
    return false;
  if (
    !Array.isArray(filters.types) ||
    !filters.types.length ||
    !filters.types.every((type) => MEDIA_TYPES.includes(type))
  )
    return false;
  if (
    ![filters.ownedByMe, filters.likedByMe, filters.dislikedByMe, filters.reportedByMe].every(
      (mode) => ['off', 'only', 'exclude'].includes(mode),
    )
  )
    return false;
  if (!filters.ranges || typeof filters.ranges !== 'object' || Array.isArray(filters.ranges))
    return false;
  return Object.entries(filters.ranges).every(
    ([key, range]) =>
      RANGE_KEYS.includes(key as RangeKey) &&
      Array.isArray(range) &&
      range.length === 2 &&
      range.every(Number.isFinite) &&
      range[0] <= range[1],
  );
}

export function saveSettings(settings: Settings, storage?: Pick<Storage, 'setItem'>): void {
  const stored: StoredSettings = {
    v: SETTINGS_VERSION,
    filters: { ...settings.filters, types: [...settings.filters.types] },
    layout: settings.layout,
    playback: settings.playback,
  };
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Settings remain active when storage is unavailable.
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
  if (f.types.size < MEDIA_TYPES.length) c++;
  if (f.ownedByMe !== 'off') c++;
  if (f.likedByMe !== 'off') c++;
  if (f.dislikedByMe !== 'off') c++;
  if (f.reportedByMe !== 'off') c++;
  for (const key of RANGE_KEYS) if (f.ranges[key]) c++;
  return c;
}
