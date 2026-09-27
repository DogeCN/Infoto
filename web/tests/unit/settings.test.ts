// Settings persistence — `vitest run` (root).
//
// The load-bearing case is the v1 → v2 drop. `layout.band` (a pixel width) became
// `layout.cols` (a count), and SETTINGS_VERSION guards that: a blob written by the old
// build carries `v: 1` and must be discarded whole rather than read as a column count.
// Reading band 260 as `cols: 260` would silently produce a nonsense layout; the version
// tag is the only thing preventing it, so it is asserted here rather than assumed.

import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../../src/settings';
import { DEFAULT_COLS, MAX_COLS, MIN_COLS } from '../../src/base/lib/band';

/** Minimal Storage stand-in: the two methods settings.ts actually touches. */
function fakeStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
}

describe('settings persistence', () => {
  it('defaults carry a column count, not a pixel band', () => {
    const d = defaultSettings();
    expect(d.layout.cols).toBe(DEFAULT_COLS);
    expect('band' in d.layout).toBe(false);
  });

  it('round-trips the layout through storage', () => {
    const storage = fakeStorage();
    saveSettings(
      { ...defaultSettings(), layout: { dir: 'v', strategy: 'shortest', cols: 4, gap: 4 } },
      storage,
    );
    const back = loadSettings(storage);
    expect(back.layout.cols).toBe(4);
    expect(back.layout.gap).toBe(4);
  });

  it('drops a v1 blob whole instead of reading its band as a column count', () => {
    const legacy = JSON.stringify({
      v: 1,
      filters: {
        types: [],
        ownedByMe: 'off',
        likedByMe: 'off',
        dislikedByMe: 'off',
        reportedByMe: 'off',
        ranges: {},
      },
      // band: 260 — under the old schema this was a pixel width; as a count it is absurd
      layout: { dir: 'v', strategy: 'shortest', band: 260, gap: 12 },
    });
    const loaded = loadSettings(fakeStorage(legacy));
    expect(loaded.layout.cols).toBe(DEFAULT_COLS);
    expect('band' in loaded.layout).toBe(false);
  });

  it('falls back to defaults for missing, mangled or blocked storage', () => {
    expect(loadSettings(fakeStorage()).layout.cols).toBe(DEFAULT_COLS);
    expect(loadSettings(fakeStorage('not json')).layout.cols).toBe(DEFAULT_COLS);
    expect(loadSettings(fakeStorage('{"v":2}')).layout.cols).toBe(DEFAULT_COLS);

    const blocked: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(blocked).layout.cols).toBe(DEFAULT_COLS);
  });

  it('keeps the default column count inside the slider bounds', () => {
    // The panel's SingleSlider is min=MIN_COLS max=MAX_COLS; a default outside that
    // range would place the handle off-track and misreport its position.
    expect(DEFAULT_COLS).toBeGreaterThanOrEqual(MIN_COLS);
    expect(DEFAULT_COLS).toBeLessThanOrEqual(MAX_COLS);
  });
});
