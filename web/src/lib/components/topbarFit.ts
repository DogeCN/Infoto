// Resolve top-bar density from measured content widths, defaulting to full density until measurements arrive.

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

/** Width interval for the continuous eight-pixel height ramp. */
const RAMP_LO = 480;
const RAMP_HI = 1600;

/** Normalized width ramp, clamped to the compact and expanded bounds. */
export function ramp(barWidth: number): number {
  if (!Number.isFinite(barWidth)) return 1;
  const t = (barWidth - RAMP_LO) / (RAMP_HI - RAMP_LO);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Continuous bar height in px. */
export function barHeight(barWidth: number): number {
  return BAR_HEIGHT_MIN + (BAR_HEIGHT_MAX - BAR_HEIGHT_MIN) * ramp(barWidth);
}

/**
 * Sizes that must grow with the bar, as fractions of its height.
 *
 * Without this the bar simply got taller while every control kept its fixed size, so the
 * extra pixels read as padding below the bar rather than as a larger bar. Icons are
 * 0.3125 of the height (20px at BAR_HEIGHT_MAX, matching the old fixed `size-5`), and the
 * count badge is 0.25 (16px, matching `size-4`).
 *
 * Exported so components read them as `calc(var(--bar-h) * …)` — one custom property on
 * the header carries the whole ramp.
 */
export const BAR_ICON_RATIO = 0.3125;
export const BAR_BADGE_RATIO = 0.25;

/** Icon box in px for a given bar width, for callers that need the number rather than CSS. */
export function barIconSize(barWidth: number): number {
  return barHeight(barWidth) * BAR_ICON_RATIO;
}

/**
 * Custom properties for the bar element. Children inherit `--bar-h`, so the whole control
 * set scales from one measurement instead of each component re-deriving the ramp.
 */
export function barCssVars(barWidth: number): string {
  return `--bar-h:${barHeight(barWidth)}px`;
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

/** Minimum spare width for a fitting layout, below the hysteresis threshold. */
export const BAR_MIN_SLACK_PX = 12;

/** Select the roomiest fitting density. Tightening uses minimum slack; loosening requires additional hysteresis. */
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
