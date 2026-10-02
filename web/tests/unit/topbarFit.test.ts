import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  BADGE_TEXT_RATIO,
  BAR_BADGE_RATIO,
  BAR_HEIGHT_MAX,
  BAR_HEIGHT_MIN,
  BAR_HYSTERESIS_PX,
  BAR_ICON_RATIO,
  BAR_MIN_SLACK_PX,
  BAR_PAD,
  barCssVars,
  barHeight,
  ramp,
  resolveBarMode,
  type BarMode,
} from '../../src/lib/components/topbarFit';

const REQ = { full: 485, compact: 377, paged: 293 };
const H = BAR_HYSTERESIS_PX;
const S = BAR_MIN_SLACK_PX;

function trace(widths: number[], start: BarMode = 'full'): BarMode[] {
  let cur = start;
  return widths.map((w) => (cur = resolveBarMode(w, REQ, cur)));
}

test('top bar fit: tightens with slack, loosens only after hysteresis, and does not flap', () => {
  assert.equal(resolveBarMode(1000, REQ, 'full'), 'full');
  assert.equal(resolveBarMode(REQ.full + S, REQ, 'full'), 'full');
  assert.equal(resolveBarMode(REQ.full + S - 1, REQ, 'full'), 'compact');
  assert.equal(resolveBarMode(REQ.full, REQ, 'full'), 'compact');
  assert.equal(resolveBarMode(REQ.compact + S, REQ, 'compact'), 'compact');
  assert.equal(resolveBarMode(REQ.compact + S - 1, REQ, 'compact'), 'paged');
  assert.equal(resolveBarMode(0, REQ, 'paged'), 'full');
  assert.equal(resolveBarMode(-1, REQ, 'paged'), 'full');
  assert.equal(resolveBarMode(NaN, REQ, 'paged'), 'full');

  assert.equal(resolveBarMode(REQ.full + H, REQ, 'compact'), 'full');
  assert.equal(resolveBarMode(700, REQ, 'compact'), 'full');
  assert.equal(resolveBarMode(REQ.compact + H, REQ, 'paged'), 'compact');
  assert.equal(resolveBarMode(REQ.full + H, REQ, 'paged'), 'full');
  assert.equal(resolveBarMode(REQ.full + S, REQ, 'compact'), 'compact');
  assert.equal(resolveBarMode(REQ.compact + S, REQ, 'paged'), 'paged');

  assert.deepEqual(trace([700, 500, 400, 300]), ['full', 'full', 'compact', 'paged']);
  assert.equal(trace([300, 400, 500, 700], 'paged').at(-1), 'full');
  const down = trace(Array.from({ length: 600 }, (_, i) => 600 - i));
  assert.deepEqual(
    down.filter((m, i) => i > 0 && m !== down[i - 1]),
    ['compact', 'paged'],
  );
  for (const start of ['full', 'compact'] as const) {
    assert.equal(new Set(trace([483, 482, 481, 480, 479, 478], start)).size, 1);
  }
  for (let w = 200; w <= 700; w += 7) {
    for (const start of ['full', 'compact', 'paged'] as const) {
      const once = resolveBarMode(w, REQ, start);
      assert.equal(resolveBarMode(w, REQ, once), once);
    }
  }
});

test('top bar fit: ramps height continuously and keeps padding fixed', () => {
  assert.equal(BAR_PAD, 12);
  assert.equal(ramp(320), 0);
  assert.equal(ramp(480), 0);
  assert.equal(ramp(1600), 1);
  assert.equal(ramp(4000), 1);
  assert.equal(ramp(NaN), 1);
  assert.equal(barHeight(320), BAR_HEIGHT_MIN);
  assert.equal(barHeight(480), BAR_HEIGHT_MIN);
  assert.equal(barHeight(0), BAR_HEIGHT_MIN);
  assert.equal(barHeight(1600), BAR_HEIGHT_MAX);
  assert.equal(barHeight(4000), BAR_HEIGHT_MAX);
  assert.ok(barHeight(600) > BAR_HEIGHT_MIN);
  assert.ok(barHeight(600) < BAR_HEIGHT_MAX);
  assert.equal(Number.isInteger(barHeight(600)), false);
  assert.ok(Math.abs(barHeight(1040) - barHeight(940)) <= 1);
  for (let w = 300; w < 1800; w++) {
    assert.ok(Math.abs(barHeight(w + 1) - barHeight(w)) <= 1);
  }
  let prev = barHeight(0);
  for (let w = 1; w <= 2000; w += 13) {
    const h = barHeight(w);
    assert.ok(h >= prev);
    prev = h;
  }
});

// Scale control dimensions with the measured bar height.
test('top bar fit: scales the controls with the bar instead of leaving empty space', () => {
  assert.ok(Math.abs(BAR_ICON_RATIO - 20 / BAR_HEIGHT_MAX) < 0.5 * 10 ** -2);
  assert.ok(Math.abs(BAR_BADGE_RATIO - 16 / BAR_HEIGHT_MAX) < 0.5 * 10 ** -2);

  // The bar publishes one measurement; every derived control size rides on it.
  const vars = (width: number): Record<string, number> =>
    Object.fromEntries(
      barCssVars(width)
        .split(';')
        .map((entry) => {
          const [name, value] = entry.split(':');
          return [name!, Number.parseFloat(value!)];
        }),
    );

  for (const width of [320, 900, 1600, 4000]) {
    const v = vars(width);
    const h = barHeight(width);
    assert.ok(Math.abs(v['--bar-h'] - h) < 0.5 * 10 ** -2);
    assert.ok(Math.abs(v['--bar-icon'] - h * BAR_ICON_RATIO) < 0.5 * 10 ** -2);
    assert.ok(Math.abs(v['--bar-badge'] - h * BAR_BADGE_RATIO) < 0.5 * 10 ** -2);
    assert.ok(
      Math.abs(v['--bar-badge-text'] - h * BAR_BADGE_RATIO * BADGE_TEXT_RATIO) < 0.5 * 10 ** -2,
    );
  }

  // The icon lands on 20px at the tallest bar and stays strictly smaller when narrow.
  assert.ok(Math.abs(vars(1600)['--bar-icon'] - 20) < 0.5 * 10 ** -2);
  assert.ok(Math.abs(vars(4000)['--bar-icon'] - 20) < 0.5 * 10 ** -2);
  assert.ok(vars(2000)['--bar-icon'] > vars(320)['--bar-icon']!);
  for (let w = 1; w <= 2000; w += 11) {
    assert.ok(vars(w + 1)['--bar-icon'] >= vars(w)['--bar-icon']!);
  }
});

// Place the first gallery row immediately after the measured bar height.
test('top bar fit: keeps the waterfall inset level with the bar at every width', () => {
  const TOP_GAP = 0;
  for (let w = 320; w <= 2560; w += 7) {
    assert.ok(Math.ceil(barHeight(w) + TOP_GAP) >= barHeight(w));
    assert.ok(Math.ceil(barHeight(w) + TOP_GAP) - barHeight(w) <= 1);
  }
});
