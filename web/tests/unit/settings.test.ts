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

/** A stored blob with a replacement `playback` block, otherwise the saved current version. */
function withPlayback(stored: string, playback: unknown): string {
  return JSON.stringify({ ...JSON.parse(stored), playback });
}

test('settings persistence: round-trips the current version, clamps ranges, and drops older blobs whole', async () => {
  // Round-trips the current settings: an explicit pixel band or null (auto).
  {
    const d = defaultSettings();
    assert.equal(d.layout.band, null);
    assert.equal('cols' in d.layout, false);
    assert.equal(d.layout.gap, 12);
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

    const nullStorage = fakeStorage();
    saveSettings(defaultSettings(), nullStorage);
    assert.equal(loadSettings(nullStorage).layout.band, null);

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
    assert.equal(dropped.layout.band, null);
    assert.equal('cols' in dropped.layout, false);
    const previousVersion = JSON.stringify({
      v: 3,
      filters: {
        types: [0, 1, 2],
        ownedByMe: 'off',
        likedByMe: 'off',
        dislikedByMe: 'off',
        reportedByMe: 'off',
        ranges: {},
      },
      layout: { dir: 'v', strategy: 'shortest', band: 260, gap: 12 },
    });
    assert.equal(loadSettings(fakeStorage(previousVersion)).layout.band, null);
    assert.equal(loadSettings(fakeStorage()).layout.band, null);
    assert.equal(loadSettings(fakeStorage('not json')).layout.band, null);
    assert.equal(loadSettings(fakeStorage('{"v":4}')).layout.band, null);

    // A stored range outside the slider is clamped, not treated as a second default.
    const low = JSON.stringify({
      v: 5,
      filters: {
        types: [0, 1, 2],
        ownedByMe: 'off',
        likedByMe: 'off',
        dislikedByMe: 'off',
        reportedByMe: 'off',
        ranges: {},
      },
      layout: { dir: 'v', strategy: 'shortest', band: 10, gap: 99 },
      playback: { volume: 0.4 },
    });
    const clamped = loadSettings(fakeStorage(low));
    assert.equal(clamped.layout.band, MIN_BAND);
    assert.equal(clamped.layout.gap, 32);
    // The layout clamp leaves the other section alone.
    assert.equal(clamped.playback.volume, 0.4);

    assert.equal(
      loadSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }).layout.band,
      null,
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
      (value: typeof stored) => {
        value.playback.volume = 'loud';
      },
      (value: typeof stored) => {
        value.playback = undefined;
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

// The playback level is the `<video>` volume property, not a mute toggle: it is a 0…1 number,
// so an out-of-range value is clamped and anything that is not a number resets the blob.
test('settings playback: volume round-trips, clamps into 0…1, and a v4 blob is discarded', () => {
  assert.equal(defaultSettings().playback.volume, 1);

  const storage = fakeStorage();
  saveSettings({ ...defaultSettings(), playback: { volume: 0.35 } }, storage);
  const stored = storage.getItem('infoto-settings')!;
  assert.equal(loadSettings(storage).playback.volume, 0.35);

  assert.equal(loadSettings(fakeStorage(withPlayback(stored, { volume: 1.7 }))).playback.volume, 1);
  assert.equal(
    loadSettings(fakeStorage(withPlayback(stored, { volume: -0.2 }))).playback.volume,
    0,
  );
  assert.equal(loadSettings(fakeStorage(withPlayback(stored, { volume: 0 }))).playback.volume, 0);

  for (const bad of ['loud', null, {}, [0.5]]) {
    assert.deepEqual(
      loadSettings(fakeStorage(withPlayback(stored, { volume: bad }))),
      defaultSettings(),
    );
  }

  // The previous schema version is dropped whole — no per-field migration, volume included.
  const v4 = JSON.stringify({ ...JSON.parse(stored), v: 4, playback: { volume: 0.5 } });
  assert.deepEqual(loadSettings(fakeStorage(v4)), defaultSettings());
});
