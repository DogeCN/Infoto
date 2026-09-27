// Top-bar density resolution — `vitest run` (root).
//
// The regressions this locks down, both found by driving a real browser rather than by
// reading the code:
//
//  1. Labels were hidden from a Tailwind breakpoint (`hidden sm:inline`), which asks
//     "how wide is the viewport" instead of "is the pill squeezed" — so they hid at
//     320px while there was still room, and stayed while things really were tight.
//  2. The first hysteresis attempt made the bar jitter at a boundary, then its fix made
//     the bar one-way: once downgraded it never climbed back, because the "stay put"
//     test asked whether the *current* (already downgraded) mode still had room — which
//     it always does. Growing the window did nothing.
//
// Both directions are exercised explicitly below; a monotonic test would not have caught
// (2).

import { describe, expect, it } from 'vitest';
import {
  BAR_HEIGHT_MAX,
  BAR_HEIGHT_MIN,
  BAR_HYSTERESIS_PX,
  BAR_MIN_SLACK_PX,
  BAR_PAD,
  barHeight,
  ramp,
  resolveBarMode,
  type BarMode,
} from '../../src/lib/components/topbarFit';

/** Requirements measured in a real browser, recomputed from the live layout
 *  (`padX + pill + left + right + (n-1)×gap`, n=4 in a single-screen row):
 *    padX 24 total (BAR_PAD=12 × 2)   pill 257 labelled / 149 icon-only
 *    left 76 (settings+sync)   right 116 (announce+select+upload)   gap 4
 *  → full 485, compact 377. `paged` is derived from two 3-item rows: 24+149+76+36+8=293. */
const REQ = { full: 485, compact: 377, paged: 293 };
const H = BAR_HYSTERESIS_PX;
const S = BAR_MIN_SLACK_PX;

/** Walk a width sequence, threading `current` through, and return the mode trace. */
function trace(widths: number[], start: BarMode = 'full'): BarMode[] {
  let cur = start;
  const out: BarMode[] = [];
  for (const w of widths) {
    cur = resolveBarMode(w, REQ, cur);
    out.push(cur);
  }
  return out;
}

describe('top bar density — tightening', () => {
  it('shows labels when everything fits', () => {
    expect(resolveBarMode(1000, REQ, 'full')).toBe('full');
    expect(resolveBarMode(REQ.full + S, REQ, 'full')).toBe('full');
  });

  it('hides the labels once the labelled form has no room to spare', () => {
    // At REQ.full exactly the layout *fits*, but its flex-1 spacer is squeezed to 0 and
    // it sits one sub-pixel from overflowing — measured as the bar flapping at 483px.
    // Requiring slack is what stops that.
    expect(resolveBarMode(REQ.full + S - 1, REQ, 'full')).toBe('compact');
    expect(resolveBarMode(REQ.full, REQ, 'full')).toBe('compact');
  });

  it('pages only after the icon-only form also has no room to spare', () => {
    // The ordering the user asked for: the arrow must not appear while the labels
    // could still be shown.
    expect(resolveBarMode(REQ.compact + S, REQ, 'compact')).toBe('compact');
    expect(resolveBarMode(REQ.compact + S - 1, REQ, 'compact')).toBe('paged');
  });

  it('keeps the roomiest layout before the bar is measured', () => {
    // `full` is the only mode that cannot overflow, so a pre-measurement frame is
    // harmless; guessing low would flash the arrow at everyone who never needs it.
    expect(resolveBarMode(0, REQ, 'paged')).toBe('full');
    expect(resolveBarMode(-1, REQ, 'paged')).toBe('full');
    expect(resolveBarMode(NaN, REQ, 'paged')).toBe('full');
  });
});

describe('top bar density — loosening (the one-way bug)', () => {
  it('climbs back from compact to full once the width is genuinely comfortable', () => {
    // The regression: growing the window past full's requirement must restore the
    // labels. Before the fix this returned 'compact' forever.
    expect(resolveBarMode(REQ.full + H, REQ, 'compact')).toBe('full');
    expect(resolveBarMode(700, REQ, 'compact')).toBe('full');
  });

  it('climbs back from paged through compact to full', () => {
    expect(resolveBarMode(REQ.compact + H, REQ, 'paged')).toBe('compact');
    expect(resolveBarMode(REQ.full + H, REQ, 'paged')).toBe('full');
  });

  it('waits for the hysteresis band before restoring a mode', () => {
    // Inside the band the bar holds the denser layout it just settled into.
    expect(resolveBarMode(REQ.full + S, REQ, 'compact')).toBe('compact');
    expect(resolveBarMode(REQ.full + H, REQ, 'compact')).toBe('full');
  });

  it('does not climb while the roomier mode would not actually fit', () => {
    expect(resolveBarMode(REQ.compact + S, REQ, 'paged')).toBe('paged');
  });
});

describe('top bar density — both directions', () => {
  it('a full round trip returns to where it started', () => {
    expect(trace([700, 500, 400, 300])).toEqual(['full', 'full', 'compact', 'paged']);
    const up = trace([300, 400, 500, 700], 'paged');
    expect(up[up.length - 1]).toBe('full');
  });

  it('crosses each boundary exactly once when sweeping down past both of them', () => {
    const widths = Array.from({ length: 600 }, (_, i) => 600 - i);
    const seq = trace(widths);
    const changes = seq.filter((m, i) => i > 0 && m !== seq[i - 1]);
    // A single, strictly ordered descent — no repeats, no bouncing back up.
    expect(changes).toEqual(['compact', 'paged']);
  });

  it('does not flap within the slack band around a boundary', () => {
    // The exact widths that flapped in the browser: 483/482/480 with a 500ms settle.
    for (const start of ['full', 'compact'] as const) {
      const seq = trace([483, 482, 481, 480, 479, 478], start);
      expect(new Set(seq).size, `start=${start}: ${seq.join(',')}`).toBe(1);
    }
  });

  it('is a fixed point: re-resolving the same width never changes the mode', () => {
    // The property a flapping bar violates. Whatever mode a width produces, feeding it
    // back as `current` must return itself.
    for (let w = 200; w <= 700; w += 7) {
      for (const start of ['full', 'compact', 'paged'] as const) {
        const once = resolveBarMode(w, REQ, start);
        const twice = resolveBarMode(w, REQ, once);
        expect(twice, `w=${w} start=${start}: ${once} -> ${twice}`).toBe(once);
      }
    }
  });
});

describe('top bar geometry', () => {
  it('keeps the inline padding fixed at every width', () => {
    // Padding was `px-3 md:px-6`; at desktop widths that 24px inset pushed the
    // controls away from the window edge for no reason. It is now a constant, and
    // `barPadding` is gone entirely — this guards the value the markup uses.
    expect(BAR_PAD).toBe(12);
  });
  it('clamps the ramp outside its span', () => {
    expect(ramp(320)).toBe(0);
    expect(ramp(480)).toBe(0);
    expect(ramp(1600)).toBe(1);
    expect(ramp(4000)).toBe(1);
    expect(ramp(NaN)).toBe(1);
  });

  it('spans exactly the two endpoint heights', () => {
    expect(barHeight(320)).toBe(BAR_HEIGHT_MIN);
    expect(barHeight(4000)).toBe(BAR_HEIGHT_MAX);
  });

  it('never jumps by more than one device-independent pixel between neighbours', () => {
    // The property the old `h-14 md:h-16` breakpoint violated: at 767→768 the
    // height changed by 8 in a single pixel. A long ramp keeps every step at 1px,
    // and the value is deliberately left unrounded so high-dpr screens can resolve
    // the sub-steps (8 × dpr positions instead of 8).
    for (let w = 300; w < 1800; w++) {
      const d = Math.abs(barHeight(w + 1) - barHeight(w));
      expect(d, `${w} -> ${w + 1} jumped ${d}px`).toBeLessThanOrEqual(1);
    }
  });

  it('returns fractional heights inside the ramp', () => {
    // Rounding these away is what limits a high-dpr screen to 8 steps; the caller
    // must be able to receive the precision. Measured in-browser: 56.8571px at
    // 600px, 58.0571px at 768px.
    expect(barHeight(600)).toBeGreaterThan(BAR_HEIGHT_MIN);
    expect(barHeight(600)).toBeLessThan(BAR_HEIGHT_MAX);
    expect(barHeight(768)).toBeGreaterThan(BAR_HEIGHT_MIN);
    expect(Number.isInteger(barHeight(600))).toBe(false);
  });

  it('still lands exactly on the endpoints outside the ramp', () => {
    expect(barHeight(480)).toBe(BAR_HEIGHT_MIN);
    expect(barHeight(1600)).toBe(BAR_HEIGHT_MAX);
    expect(barHeight(0)).toBe(BAR_HEIGHT_MIN);
  });

  it('is monotonic — never shrinks as the window widens', () => {
    let prev = barHeight(0);
    for (let w = 1; w <= 2000; w += 13) {
      const h = barHeight(w);
      expect(h, `w=${w}`).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('changes by at most one pixel per 100px of width in the ramp span', () => {
    // Why the span is 480→1600: 8px of travel over 1120px means a visible step every
    // ~140px, so dragging a window edge passes through them without a lurch.
    const per100 = Math.abs(barHeight(1040) - barHeight(940));
    expect(per100).toBeLessThanOrEqual(1);
  });
});
