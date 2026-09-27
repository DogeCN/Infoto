import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../../src/settings';
import { DEFAULT_BAND, MAX_BAND, MIN_BAND } from '../../src/base/lib/band';

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
  it('round-trips v3 pixel bands and drops anything else', () => {
    const d = defaultSettings();
    expect(d.layout.band).toBe(DEFAULT_BAND);
    expect('cols' in d.layout).toBe(false);
    expect(DEFAULT_BAND).toBeGreaterThanOrEqual(MIN_BAND);
    expect(DEFAULT_BAND).toBeLessThanOrEqual(MAX_BAND);

    const storage = fakeStorage();
    saveSettings(
      { ...defaultSettings(), layout: { dir: 'v', strategy: 'shortest', band: 340, gap: 4 } },
      storage,
    );
    const back = loadSettings(storage);
    expect(back.layout.band).toBe(340);
    expect(back.layout.gap).toBe(4);

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
      layout: { dir: 'v', strategy: 'shortest', cols: 4, gap: 12 },
    });
    const dropped = loadSettings(fakeStorage(legacy));
    expect(dropped.layout.band).toBe(DEFAULT_BAND);
    expect('cols' in dropped.layout).toBe(false);
    expect(loadSettings(fakeStorage()).layout.band).toBe(DEFAULT_BAND);
    expect(loadSettings(fakeStorage('not json')).layout.band).toBe(DEFAULT_BAND);
    expect(loadSettings(fakeStorage('{"v":3}')).layout.band).toBe(DEFAULT_BAND);
    const low = JSON.stringify({
      v: 3,
      filters: {
        types: [0, 1, 2],
        ownedByMe: 'off',
        likedByMe: 'off',
        dislikedByMe: 'off',
        reportedByMe: 'off',
        ranges: {},
      },
      layout: { dir: 'v', strategy: 'shortest', band: 10, gap: 99 },
    });
    expect(loadSettings(fakeStorage(low)).layout).toMatchObject({ band: MIN_BAND, gap: 32 });
    expect(
      loadSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }).layout.band,
    ).toBe(DEFAULT_BAND);
  });
});
