// Settings persistence — `vitest run` (root).
//
// v3 restores `layout.band` as a pixel width. The version guard drops v2 blobs so a
// stored column count cannot be silently interpreted as a width.

import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../../src/settings';
import { DEFAULT_BAND, MAX_BAND, MIN_BAND } from '../../src/base/lib/band';

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
  it('defaults carry a target pixel band, not a column count', () => {
    const d = defaultSettings();
    expect(d.layout.band).toBe(DEFAULT_BAND);
    expect('cols' in d.layout).toBe(false);
  });

  it('round-trips the layout through storage', () => {
    const storage = fakeStorage();
    saveSettings(
      { ...defaultSettings(), layout: { dir: 'v', strategy: 'shortest', band: 340, gap: 4 } },
      storage,
    );
    const back = loadSettings(storage);
    expect(back.layout.band).toBe(340);
    expect(back.layout.gap).toBe(4);
  });

  it('drops a v2 blob whole instead of reading its column count as a pixel band', () => {
    const legacy = JSON.stringify({
      v: 2,
      filters: {
        types: [],
        ownedByMe: 'off',
        likedByMe: 'off',
        dislikedByMe: 'off',
        reportedByMe: 'off',
        ranges: {},
      },
      // A column count is not a pixel width and must not leak into the current model.
      layout: { dir: 'v', strategy: 'shortest', cols: 4, gap: 12 },
    });
    const loaded = loadSettings(fakeStorage(legacy));
    expect(loaded.layout.band).toBe(DEFAULT_BAND);
    expect('cols' in loaded.layout).toBe(false);
  });

  it('falls back to defaults for missing, mangled or blocked storage', () => {
    expect(loadSettings(fakeStorage()).layout.band).toBe(DEFAULT_BAND);
    expect(loadSettings(fakeStorage('not json')).layout.band).toBe(DEFAULT_BAND);
    expect(loadSettings(fakeStorage('{"v":3}')).layout.band).toBe(DEFAULT_BAND);

    const blocked: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(blocked).layout.band).toBe(DEFAULT_BAND);
  });

  it('keeps the default pixel band inside the slider bounds', () => {
    // The panel's SingleSlider is min=MIN_BAND max=MAX_BAND; a default outside that
    // range would place the handle off-track and misreport its position.
    expect(DEFAULT_BAND).toBeGreaterThanOrEqual(MIN_BAND);
    expect(DEFAULT_BAND).toBeLessThanOrEqual(MAX_BAND);
    expect(MIN_BAND).toBe(200);
    expect(MAX_BAND).toBe(800);
  });
});
