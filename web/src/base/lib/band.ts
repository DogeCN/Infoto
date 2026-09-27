// Band (target column width) → actual column count, and the reverse. Pure, no DOM.
//
// Why this exists: `band` used to be a bare pixel number, so a 260px band on a
// 320px phone viewport collapsed the waterfall to a single column
// (round((320-12+12)/(260+12)) === 1) while the settings slider — whose own range
// started at 200 — could not even reach the value that would give three columns.
// Column count is the thing a layout is actually judged on, and it is a ratio of the
// viewport; pixels are not. So the persisted setting is now a *column count* and the
// pixel band is derived from the measured cross size at layout time.

/** Column counts the setting allows. 1 is a legitimate deliberate choice (large
 *  single-column view), not an error state, so it stays in the range. */
export const MIN_COLS = 1;
export const MAX_COLS = 6;
export const DEFAULT_COLS = 2;

/**
 * Pixels a column must have before an extra column is worth adding. Below this the
 * gap starts eating the content and cards become unreadable, so the count holds
 * rather than crowding. Roughly a large phone-viewport card at default density.
 */
const MIN_BAND_PX = 120;

function clampCols(cols: number): number {
  if (!Number.isFinite(cols)) return DEFAULT_COLS;
  return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(cols)));
}

/**
 * Column count for a cross size: the requested count, reduced while each column
 * would be narrower than `MIN_BAND_PX`, and never below 1. Narrow viewports
 * therefore get fewer columns instead of unusably thin ones.
 */
export function colsForCross(cross: number, gap: number, wanted: number): number {
  const target = clampCols(wanted);
  if (!Number.isFinite(cross) || cross <= 0) return target;
  let cols = target;
  while (cols > MIN_COLS && (cross - (cols - 1) * gap) / cols < MIN_BAND_PX) cols -= 1;
  return cols;
}

/**
 * Pixel band for a requested column count: the width that yields exactly `cols`
 * equal columns, so `layout.ts`'s `round((cross + gap) / (band + gap))` recovers
 * the same count. Clamped to at least 1px so a degenerate cross size cannot
 * produce a zero band and an infinite loop in the engine's row packing.
 */
export function bandForCols(cross: number, gap: number, cols: number): number {
  const n = clampCols(cols);
  if (!Number.isFinite(cross) || cross <= 0) return MIN_BAND_PX;
  return Math.max(1, (cross - (n - 1) * gap) / n);
}
