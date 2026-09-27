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

export interface BarRequirements {
  /** One screen, sort labels visible. */
  full: number;
  /** One screen, sort labels hidden. */
  compact: number;
  /** The wider of the two paged screens. */
  paged: number;
}

/**
 * Pick the densest layout that fits `available` px.
 *
 * Ordered widest-first, and each step is only taken when the previous one genuinely
 * does not fit — so a control gives ground exactly when it is squeezed, never on a
 * viewport-size guess.
 */
export function resolveBarMode(available: number, req: BarRequirements): BarMode {
  // Unmeasured (available <= 0): render the roomiest layout rather than guessing low.
  if (!Number.isFinite(available) || available <= 0) return 'full';
  if (available >= req.full) return 'full';
  if (available >= req.compact) return 'compact';
  return 'paged';
}

/**
 * Horizontal padding the bar adds around its content at a given width. Mirrors the
 * `px-3 md:px-6` classes on the screen rows; kept here so the measured content widths
 * stay viewport-independent and can be sampled once instead of on every resize.
 */
export function barPadX(barWidth: number): number {
  return barWidth >= 768 ? 24 : 12;
}
