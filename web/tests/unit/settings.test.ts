import { test } from 'vitest';
import assert from 'node:assert/strict';
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

test('settings persistence: validates persisted settings and applies filters', async () => {
  // Round-trips v3 pixel bands and drops anything else.
  {
    const d = defaultSettings();
    assert.equal(d.layout.band, DEFAULT_BAND);
    assert.equal('cols' in d.layout, false);
    assert.ok(DEFAULT_BAND >= MIN_BAND);
    assert.ok(DEFAULT_BAND <= MAX_BAND);
    assert.equal((MAX_BAND - MIN_BAND) % 10, 0);

    const storage = fakeStorage();
    saveSettings(
      { ...defaultSettings(), layout: { dir: 'v', strategy: 'shortest', band: 340, gap: 4 } },
      storage,
    );
    const back = loadSettings(storage);
    assert.equal(back.layout.band, 340);
    assert.equal(back.layout.gap, 4);

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
    assert.equal(dropped.layout.band, DEFAULT_BAND);
    assert.equal('cols' in dropped.layout, false);
    assert.equal(loadSettings(fakeStorage()).layout.band, DEFAULT_BAND);
    assert.equal(loadSettings(fakeStorage('not json')).layout.band, DEFAULT_BAND);
    assert.equal(loadSettings(fakeStorage('{"v":3}')).layout.band, DEFAULT_BAND);
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
    const clamped = loadSettings(fakeStorage(low)).layout;
    assert.equal(clamped.band, MIN_BAND);
    assert.equal(clamped.gap, 32);
    assert.equal(
      loadSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }).layout.band,
      DEFAULT_BAND,
    );
  }

  // Resets malformed current-version settings as a complete unit.
  {
    const storage = fakeStorage();
    saveSettings(defaultSettings(), storage);
    const stored = JSON.parse(storage.getItem('infoto-settings')!);
    for (const mutate of [
      (value: typeof stored) => {
        value.filters.types = [];
      },
      (value: typeof stored) => {
        value.filters.types = [99];
      },
      (value: typeof stored) => {
        value.filters.ranges = null;
      },
      (value: typeof stored) => {
        value.filters.ranges = { size: [10, 1] };
      },
      (value: typeof stored) => {
        value.filters.ownedByMe = 'invalid';
      },
      (value: typeof stored) => {
        value.layout.dir = 'invalid';
      },
      (value: typeof stored) => {
        value.layout.band = 'wide';
      },
    ]) {
      const value = structuredClone(stored);
      mutate(value);
      assert.deepEqual(loadSettings(fakeStorage(JSON.stringify(value))), defaultSettings());
    }
    assert.doesNotThrow(() => loadSettings());
    assert.doesNotThrow(() => saveSettings(defaultSettings()));
  }
});
