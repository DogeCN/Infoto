// Persisted target column width, in CSS pixels. The layout engine derives the
// column count from this width and the measured cross size. A stored width is an
// explicit user choice; the untouched default follows the canvas instead (see
// `autoBand`) so a narrow screen does not open at one oversized column.

import { clamp } from './num.ts';

export const MIN_BAND = 100;
export const MAX_BAND = 800;
export const DEFAULT_BAND = 260;

/**
 * The auto default for `layout.band = null`: half the measured cross size, capped
 * at `DEFAULT_BAND`. Two columns fill the canvas while it is narrow enough that
 * half of it is below the reference width; once the canvas can hold the reference,
 * the cap takes over and wide screens keep the historical density.
 *
 * This is a single continuous mapping, not a minimum-column rule: the two-column
 * phone layout falls out of the geometry, and the same formula is what keeps the
 * auto band monotonic as the window is resized.
 */
export function autoBand(cross: number, gap: number): number {
  return Math.round(clamp((cross - gap) / 2, MIN_BAND, DEFAULT_BAND));
}
