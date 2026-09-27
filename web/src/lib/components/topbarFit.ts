// Top-bar fit resolution. Pure: no DOM.
//
// Density comes from measured content widths, not a viewport breakpoint:
//
//   full     — labels + all eight controls, one screen
//   compact  — icon-only pill + all eight controls, one screen
//   paged    — icon-only pill, two sliding screens (the arrow is enabled)
//
// `full` is the unmeasured default. It is the roomiest layout, so the first frame
// does not flash the pager arrow on a bar that never needs it.

export type BarMode = 'full' | 'compact' | 'paged';

/** Ordered widest-first; the index is the density rank. */
const RANK: Record<BarMode, number> = { full: 0, compact: 1, paged: 2 };

// Height ramps linearly with bar width. Padding stays constant so the controls do not
// drift away from the window edge as the bar widens.

/** Height endpoints, in CSS pixels. */
export const BAR_HEIGHT_MIN = 56;
export const BAR_HEIGHT_MAX = 64;

/** Fixed inline padding, both sides. */
export const BAR_PAD = 12;

/**
 * Width range over which the height ramps from compact to expanded.
 *
 * Travel is 8 CSS px over 1120px of width, about one CSS pixel per 140px. The result
 * is not rounded: a CSS pixel maps to `dpr` device pixels, so the fraction is visible
 * on high-density screens. A dpr-1 rasteriser drops it and keeps the same 8 steps.
 */
const RAMP_LO = 480;
const RAMP_HI = 1600;

/**
 * Normalised ramp position for a bar width, clamped to [0, 1].
 *
 * Below `RAMP_LO` the bar is at its compact height; above `RAMP_HI` at its expanded one.
 * Anything in between interpolates linearly, so no single pixel of width produces a step.
 */
export function ramp(barWidth: number): number {
  if (!Number.isFinite(barWidth)) return 1;
  const t = (barWidth - RAMP_LO) / (RAMP_HI - RAMP_LO);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Continuous bar height in px. */
export function barHeight(barWidth: number): number {
  return BAR_HEIGHT_MIN + (BAR_HEIGHT_MAX - BAR_HEIGHT_MIN) * ramp(barWidth);
}

export interface BarRequirements {
  /** One screen, sort labels visible. */
  full: number;
  /** One screen, sort labels hidden. */
  compact: number;
  /** The wider of the two paged screens. */
  paged: number;
}

/**
 * Extra slack required before the bar returns to a roomier mode.
 * Without it, thresholds a pixel apart flip-flop on sub-pixel width noise.
 */
export const BAR_HYSTERESIS_PX = 24;

/**
 * Slack a mode must have before it is used. A layout that fits exactly has its
 * flex spacer at 0 and sits one sub-pixel from overflow. This floor is smaller than
 * the hysteresis band, so it cannot hide a real step between modes.
 */
export const BAR_MIN_SLACK_PX = 12;

/**
 * Densest layout that fits `available` px. Leaves `current` only when that mode's
 * comfort zone has been left.
 *
 * Tightening applies as soon as the current mode no longer fits with
 * `BAR_MIN_SLACK_PX` to spare. Loosening waits until the roomier mode fits with
 * `BAR_HYSTERESIS_PX` to spare. The stay-put test must not ask whether the current,
 * already denser mode still fits — it always does, so the bar would never climb back.
 */
export function resolveBarMode(
  available: number,
  req: BarRequirements,
  current: BarMode = 'full',
): BarMode {
  // Unmeasured (available <= 0): render the roomiest layout rather than guessing low.
  if (!Number.isFinite(available) || available <= 0) return 'full';

  const need: Record<BarMode, number> = {
    full: req.full,
    compact: req.compact,
    paged: req.paged,
  };
  const modes: readonly BarMode[] = ['full', 'compact', 'paged'];
  /** A mode is only usable with `slack` px to spare. */
  const fits = (m: BarMode, slack: number): boolean => available >= need[m] + slack;

  // Climb to a roomier mode only once it has the full hysteresis band to spare.
  for (let r = 0; r < RANK[current]; r++) {
    const candidate = modes[r]!;
    if (fits(candidate, BAR_HYSTERESIS_PX)) return candidate;
  }

  // Otherwise drop to a denser mode as soon as the current one stops being comfortable.
  if (!fits(current, BAR_MIN_SLACK_PX)) {
    for (let r = RANK[current] + 1; r < modes.length; r++) {
      const candidate = modes[r]!;
      if (fits(candidate, BAR_MIN_SLACK_PX)) return candidate;
    }
    return 'paged';
  }

  return current;
}
