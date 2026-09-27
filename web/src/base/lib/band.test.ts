// Unit tests for band ↔ columns — `vitest run` (root).
//
// The regression these lock down is concrete: a 260px band on a 320px phone viewport
// used to collapse the waterfall to one column, because `band` was a bare pixel
// value that ignored the viewport entirely. The column count is now the setting and
// the pixel band is derived, so the round-trip below must hold at any cross size.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_COLS, MAX_COLS, MIN_COLS, bandForCols, colsForCross } from './band.ts';
import { computeLayout } from './layout.ts';

const GAP = 12;

/** The real phone: 1080 physical px at density 540 → a 320 CSS-px viewport. */
const PHONE_CROSS = 320 - 2 * 16;
const DESKTOP_CROSS = 1200 - 2 * 16;

test('round-trip: a derived band reproduces the requested column count', () => {
  for (const cross of [PHONE_CROSS, DESKTOP_CROSS, 700, 2000]) {
    for (let cols = MIN_COLS; cols <= MAX_COLS; cols++) {
      const band = bandForCols(cross, GAP, cols);
      // Mirrors the engine's own column arithmetic (layout.ts vShortest).
      const recovered = Math.max(1, Math.round((cross + GAP) / (band + GAP)));
      assert.equal(
        recovered,
        cols,
        `cross=${cross} cols=${cols} band=${band} recovered ${recovered}`,
      );
    }
  }
});

test('the phone default is more than one column', () => {
  // The bug: band=260 with GAP=12 gave round(320/(260+12)) === 1.
  const cols = colsForCross(PHONE_CROSS, GAP, DEFAULT_COLS);
  assert.equal(cols, 2, 'a 320px viewport must not collapse to a single column');
});

test('colsForCross holds the count back when a column would be too thin', () => {
  // 6 columns across 300px is ~44px each — unusable, so it degrades.
  const cols = colsForCross(PHONE_CROSS, GAP, 6);
  assert.ok(cols < 6, `expected fewer than 6 columns, got ${cols}`);
  const band = bandForCols(PHONE_CROSS, GAP, cols);
  assert.ok(band >= 100, `degraded band ${band} is too thin`);
});

test('colsForCross never drops below one and never exceeds the request', () => {
  assert.equal(colsForCross(40, GAP, 4), MIN_COLS);
  assert.equal(colsForCross(DESKTOP_CROSS, GAP, 2), 2);
  assert.equal(colsForCross(0, GAP, 3), 3, 'an unmeasured cross keeps the request');
});

test('a degenerate cross size still yields a usable band', () => {
  // Zero would otherwise reach the engine's row-packing loop and spin.
  assert.ok(bandForCols(0, GAP, 3) >= 1);
  assert.ok(bandForCols(-50, GAP, 3) >= 1);
  assert.ok(bandForCols(PHONE_CROSS, GAP, 0) >= 1, 'cols=0 is clamped, not divided by');
});

test('non-finite input is rejected rather than propagated', () => {
  assert.equal(colsForCross(NaN, GAP, 3), 3);
  assert.equal(colsForCross(1000, GAP, NaN), DEFAULT_COLS);
  assert.equal(colsForCross(1000, GAP, 99), MAX_COLS);
  assert.equal(colsForCross(1000, GAP, -4), MIN_COLS);
});

test('the engine packs the derived column count on a phone viewport', () => {
  // End-to-end through computeLayout: the derived band must actually produce
  // distinct column x positions, which is what "more than one row" means.
  const photos = Array.from({ length: 12 }, (_, i) => ({ id: i, w: 4000, h: 3000 }));
  const res = computeLayout(photos, {
    dir: 'v',
    strategy: 'shortest',
    cross: PHONE_CROSS,
    band: bandForCols(PHONE_CROSS, GAP, DEFAULT_COLS),
    gap: GAP,
  });
  const xs = new Set(res.boxes.map((b) => Math.round(b.x)));
  assert.equal(xs.size, 2, `expected 2 columns, boxes start at x = ${[...xs]}`);
  assert.ok(res.totalH > 0);
});
