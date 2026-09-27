import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_BAND, MAX_BAND, MIN_BAND } from './band.ts';
import { computeLayout } from './layout.ts';

test('the slider band is a pixel width and a smaller band packs more columns', () => {
  assert.equal(MIN_BAND, 100);
  assert.equal(DEFAULT_BAND, 260);
  assert.equal(MAX_BAND, 800);
  assert.ok(DEFAULT_BAND >= MIN_BAND && DEFAULT_BAND <= MAX_BAND);
  assert.equal((MAX_BAND - MIN_BAND) % 10, 0);

  const photos = Array.from({ length: 12 }, (_, id) => ({ id, w: 4, h: 3 }));
  const columns = (band: number) =>
    new Set(
      computeLayout(photos, {
        dir: 'v',
        strategy: 'shortest',
        cross: 1200,
        band,
        gap: 12,
      }).boxes.map((box) => Math.round(box.x)),
    ).size;
  assert.ok(columns(MIN_BAND) > columns(DEFAULT_BAND));
  assert.equal(columns(260), 4);
  assert.equal(columns(400), 3);
});
