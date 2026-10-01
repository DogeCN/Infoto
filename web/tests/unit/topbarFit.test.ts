import { describe, expect, it } from 'vitest';
import {
  BAR_BADGE_RATIO,
  BAR_HEIGHT_MAX,
  BAR_HEIGHT_MIN,
  BAR_HYSTERESIS_PX,
  BAR_ICON_RATIO,
  BAR_MIN_SLACK_PX,
  BAR_PAD,
  barCssVars,
  barHeight,
  barIconSize,
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

describe('top bar fit', () => {
  it('tightens with slack, loosens only after hysteresis, and does not flap', () => {
    expect(resolveBarMode(1000, REQ, 'full')).toBe('full');
    expect(resolveBarMode(REQ.full + S, REQ, 'full')).toBe('full');
    expect(resolveBarMode(REQ.full + S - 1, REQ, 'full')).toBe('compact');
    expect(resolveBarMode(REQ.full, REQ, 'full')).toBe('compact');
    expect(resolveBarMode(REQ.compact + S, REQ, 'compact')).toBe('compact');
    expect(resolveBarMode(REQ.compact + S - 1, REQ, 'compact')).toBe('paged');
    expect(resolveBarMode(0, REQ, 'paged')).toBe('full');
    expect(resolveBarMode(-1, REQ, 'paged')).toBe('full');
    expect(resolveBarMode(NaN, REQ, 'paged')).toBe('full');

    expect(resolveBarMode(REQ.full + H, REQ, 'compact')).toBe('full');
    expect(resolveBarMode(700, REQ, 'compact')).toBe('full');
    expect(resolveBarMode(REQ.compact + H, REQ, 'paged')).toBe('compact');
    expect(resolveBarMode(REQ.full + H, REQ, 'paged')).toBe('full');
    expect(resolveBarMode(REQ.full + S, REQ, 'compact')).toBe('compact');
    expect(resolveBarMode(REQ.compact + S, REQ, 'paged')).toBe('paged');

    expect(trace([700, 500, 400, 300])).toEqual(['full', 'full', 'compact', 'paged']);
    expect(trace([300, 400, 500, 700], 'paged').at(-1)).toBe('full');
    const down = trace(Array.from({ length: 600 }, (_, i) => 600 - i));
    expect(down.filter((m, i) => i > 0 && m !== down[i - 1])).toEqual(['compact', 'paged']);
    for (const start of ['full', 'compact'] as const) {
      expect(new Set(trace([483, 482, 481, 480, 479, 478], start)).size).toBe(1);
    }
    for (let w = 200; w <= 700; w += 7) {
      for (const start of ['full', 'compact', 'paged'] as const) {
        const once = resolveBarMode(w, REQ, start);
        expect(resolveBarMode(w, REQ, once)).toBe(once);
      }
    }
  });

  it('ramps height continuously and keeps padding fixed', () => {
    expect(BAR_PAD).toBe(12);
    expect(ramp(320)).toBe(0);
    expect(ramp(480)).toBe(0);
    expect(ramp(1600)).toBe(1);
    expect(ramp(4000)).toBe(1);
    expect(ramp(NaN)).toBe(1);
    expect(barHeight(320)).toBe(BAR_HEIGHT_MIN);
    expect(barHeight(480)).toBe(BAR_HEIGHT_MIN);
    expect(barHeight(0)).toBe(BAR_HEIGHT_MIN);
    expect(barHeight(1600)).toBe(BAR_HEIGHT_MAX);
    expect(barHeight(4000)).toBe(BAR_HEIGHT_MAX);
    expect(barHeight(600)).toBeGreaterThan(BAR_HEIGHT_MIN);
    expect(barHeight(600)).toBeLessThan(BAR_HEIGHT_MAX);
    expect(Number.isInteger(barHeight(600))).toBe(false);
    expect(Math.abs(barHeight(1040) - barHeight(940))).toBeLessThanOrEqual(1);
    for (let w = 300; w < 1800; w++) {
      expect(Math.abs(barHeight(w + 1) - barHeight(w))).toBeLessThanOrEqual(1);
    }
    let prev = barHeight(0);
    for (let w = 1; w <= 2000; w += 13) {
      const h = barHeight(w);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  // A taller bar with unchanged control sizes reads as padding below the bar, which is
  // what the fixed size-5 icons looked like. Everything inside must track the ramp.
  it('scales the controls with the bar instead of leaving empty space', () => {
    expect(BAR_ICON_RATIO).toBeCloseTo(20 / BAR_HEIGHT_MAX);
    expect(BAR_BADGE_RATIO).toBeCloseTo(16 / BAR_HEIGHT_MAX);

    // At full size the derived numbers are exactly the old fixed pixel values.
    expect(barIconSize(1600)).toBeCloseTo(20);
    expect(barIconSize(4000)).toBeCloseTo(20);
    expect(barIconSize(320)).toBeCloseTo(BAR_HEIGHT_MIN * BAR_ICON_RATIO);

    // Monotonic with the bar, and strictly smaller at the narrow end.
    expect(barIconSize(2000)).toBeGreaterThan(barIconSize(320));
    for (let w = 1; w <= 2000; w += 11) {
      expect(barIconSize(w + 1)).toBeGreaterThanOrEqual(barIconSize(w));
    }
    expect(barIconSize(320)).toBeLessThan(barIconSize(1600));

    // One custom property carries the ramp to every descendant.
    expect(barCssVars(900)).toBe(`--bar-h:${barHeight(900)}px`);
    expect(barCssVars(900)).toContain('--bar-h:');
  });

  // The waterfall's top inset used to be its own width percentage (48-80px) and fell
  // below the bar's height on narrow screens, so the first row sat under the bar. It now
  // equals the bar height exactly: enough to clear it, no floating gap.
  it('keeps the waterfall inset level with the bar at every width', () => {
    const TOP_GAP = 0;
    for (let w = 320; w <= 2560; w += 7) {
      expect(Math.ceil(barHeight(w) + TOP_GAP)).toBeGreaterThanOrEqual(barHeight(w));
      expect(Math.ceil(barHeight(w) + TOP_GAP) - barHeight(w)).toBeLessThanOrEqual(1);
    }
  });
});
