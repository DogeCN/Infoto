import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_BAND, MAX_BAND, MIN_BAND } from './band.ts';
import { computeLayout } from './layout.ts';

const GAP = 12;

test('target band width directly controls the resulting column count', () => {
  const photos = Array.from({ length: 12 }, (_, id) => ({ id, w: 4, h: 3 }));
  const countColumns = (band: number) => {
    const result = computeLayout(photos, {
      dir: 'v',
      strategy: 'shortest',
      cross: 1200,
      band,
      gap: GAP,
    });
    return new Set(result.boxes.map((box) => Math.round(box.x))).size;
  };

  assert.equal(countColumns(260), 4);
  assert.equal(countColumns(400), 3);
});

test('the default band is within the slider bounds', () => {
  assert.equal(DEFAULT_BAND, 260);
  assert.ok(DEFAULT_BAND >= MIN_BAND);
  assert.ok(DEFAULT_BAND <= MAX_BAND);
  assert.equal(MIN_BAND, 200);
  assert.equal(MAX_BAND, 800);
});
