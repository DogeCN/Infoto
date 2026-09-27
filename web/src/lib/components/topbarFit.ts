// Top-bar fit resolution — pure, no DOM.
//
// The bar used to decide its own density from a Tailwind breakpoint
// (`hidden sm:inline` inside SegmentedControl). That is the wrong question: the
// breakpoint knows the *viewport* width, not whether the sort pill was actually
// squeezed. On a 320px phone the labels were already hidden even though the pill still
// had room, and on a wide window with a long translation the labels vanished while
// nothing was tight at all.
//
// So the three densities are derived from measured widths instead:
//
//   full     — labels + all eight controls, one screen
//   compact  — icon-only pill + all eight controls, one screen
//   paged    — icon-only pill, two sliding screens (the arrow is enabled)
//
// `full` is the roomiest, so it is the unmeasured default: rendering it for one frame
// before the measurement lands can overflow briefly, whereas starting in `paged` would
// flash the arrow at every user who never needed it.

export type BarMode = 'full' | 'compact' | 'paged';

/** Ordered widest-first; the index is the density rank. */
const RANK: Record<BarMode, number> = { full: 0, compact: 1, paged: 2 };

// ---- continuous geometry --------------------------------------------------------
//
// The bar's height used to be `h-14 md:h-16` — a hard breakpoint at 768px. Measured:
// 767px → 55px tall, 768px → 63px, so crossing one pixel snapped the whole bar, the
// opposite of the gradual adaptation the rest of the bar now does. The height is a
// linear ramp instead: no width at which it jumps.
//
// Padding is deliberately NOT ramped. It was `px-3 md:px-6`, and at desktop widths that
// 24px inset was simply too much — the controls drifted away from the window edge for no
// reason. `px-3` is kept unconditionally, which also removes a second breakpoint from
// the bar rather than trading one for another.

/** Height endpoints: the old `h-14` / `h-16` values. */
export const BAR_HEIGHT_MIN = 56;
export const BAR_HEIGHT_MAX = 64;

/** Fixed inline padding, both sides (the old `px-3`). */
export const BAR_PAD = 12;

/**
 * Width range over which the height ramps from compact to expanded.
 *
 * The span sets how fine the steps are. The total travel is only 8 CSS px, so over
 * 480→1600 (1120px) the height advances one whole CSS pixel every ~140px of width, and
 * a window drag passes through the steps without a single lurch.
 *
 * The returned value is intentionally NOT rounded. How many steps actually reach the
 * screen is the device's business, not ours: a CSS pixel maps to `dpr` device pixels, so
 * the 8px ramp spans `8 × dpr` distinguishable positions. On the reference phone
 * (density 540 → dpr 3.375) that is 27 steps rather than 8, and the fractional values
 * are what buy them — rounding to whole CSS px would throw all but 8 away. On a dpr-1
 * desktop the rasteriser drops the extra precision and the same 8 steps remain, which is
 * no worse than before.
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
 * Slack that must be given back before the bar returns to a roomier mode.
 *
 * Without it the bar flip-flops across a boundary: on a 483px bar the `full` and
 * `compact` thresholds are 1px apart, so a sub-pixel width change (or a scrollbar
 * appearing and disappearing) restarts the transition and the bar visibly twitches
 * while the user drags a window edge.
 */
export const BAR_HYSTERESIS_PX = 24;

/**
 * Breathing room a mode must have before it is used at all.
 *
 * "Does it fit" is the wrong question on its own. A layout whose requirement is met
 * *exactly* has a `flex-1` spacer squeezed to 0px and sits one sub-pixel away from
 * overflowing — which is what made the bar flap between `full` and `compact` at 483px
 * even with a 500ms settle: the requirement was satisfied, but only just. Requiring a
 * margin means the chosen mode is always genuinely comfortable, so ordinary width noise
 * cannot tip it over.
 *
 * This is a floor, not a preference: it is smaller than the hysteresis band, so it
 * cannot mask a real step between two modes.
 */
export const BAR_MIN_SLACK_PX = 12;

/**
 * Pick the densest layout that fits `available` px, stepping away from `current` only
 * when the width has genuinely left the current mode's comfort zone.
 *
 * The two directions are deliberately asymmetric:
 *
 *  - **Tightening** (denser): the new mode must fail to fit *with* `BAR_MIN_SLACK_PX`
 *    to spare. This is the moment the layout really no longer has room, so it applies
 *    immediately.
 *  - **Loosening** (roomier): the roomier mode must fit *plus* `BAR_HYSTERESIS_PX`.
 *    Restoring the comfortable layout early would undo a step the user just watched
 *    happen, and without the extra band the bar oscillates at the boundary.
 *
 * Getting that asymmetry wrong is what made a bar stuck in `compact` forever: the
 * "stay put" test asked whether the *current* (already downgraded) mode still had room,
 * which it always does — so the width could grow past `full`'s requirement and the bar
 * never climbed back.
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
