// Resolve top-bar density from measured content widths, defaulting to full density until measurements arrive.

export type BarMode = 'full' | 'compact' | 'icon' | 'paged';

/**
 * Ordered widest-first; the index is the density rank. `icon` sits between `compact` and
 * `paged`: the pill's third fold (icons only, still one screen, no arrow) happens here,
 * and the arrow only appears once even that cannot fit — so the arrow fold is last.
 */
const RANK: Record<BarMode, number> = { full: 0, compact: 1, icon: 2, paged: 3 };

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

/** Icon and badge dimensions as fractions of the measured bar height. */
export const BAR_ICON_RATIO = 0.3125;
export const BAR_BADGE_RATIO = 0.25;
/** Badge text as a fraction of the badge box. */
export const BADGE_TEXT_RATIO = 0.625;

/**
 * Custom properties for the bar element. Children inherit `--bar-h` plus the sizes derived
 * from it, so the whole control set scales from one measurement instead of each component
 * re-deriving the ramp or re-typing the ratios.
 */
export function barCssVars(barWidth: number): string {
  const h = barHeight(barWidth);
  return [
    `--bar-h:${h}px`,
    `--bar-icon:${h * BAR_ICON_RATIO}px`,
    `--bar-badge:${h * BAR_BADGE_RATIO}px`,
    `--bar-badge-text:${h * BAR_BADGE_RATIO * BADGE_TEXT_RATIO}px`,
  ].join(';');
}

/** Width each shape needs, per mode. */
interface BarRequirements {
  /** One screen, sort labels visible. */
  full: number;
  /** One screen, sort labels hidden except the active item. */
  compact: number;
  /** One screen, icons only — the pill's third fold, reached before the arrow appears. */
  icon: number;
  /** The wider of the two paged screens, reached only once even icons-only cannot fit one screen. */
  paged: number;
}

/** Spare width required before switching to a roomier density. Kept small so the bar does
 * not fold a mode away while there is still room — the slack was the source of premature
 * density drops that left the middle empty. */
export const BAR_HYSTERESIS_PX = 14;

/** Minimum spare width for a fitting layout, below the hysteresis threshold. Small: the bar
 * holds the roomiest fitting mode until it genuinely will not fit, instead of retracting early. */
export const BAR_MIN_SLACK_PX = 6;

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
    icon: req.icon,
    paged: req.paged,
  };
  const modes: readonly BarMode[] = ['full', 'compact', 'icon', 'paged'];
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
