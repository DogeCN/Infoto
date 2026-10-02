// The measured top-bar height, shared by everything laid out beneath the bar.
//
// TopBar owns the measurement (it already re-measures on resize and on density
// changes) and publishes it twice: as `--bar-h` on the root element, for CSS, and
// here, for Svelte. Consumers must not re-derive the height from a width they
// measured themselves — the bar's width and the canvas width are different
// quantities, and restating the ramp is how the two drift apart.

/** Bar height in CSS pixels; 0 until the bar has measured itself. */
export const barHeightPx = $state({ value: 0 });

/**
 * The bar height as a plain number for layout maths, falling back to `fallback`
 * before the first measurement lands (server render, or the bar mounting later).
 */
export function barHVar(fallback = 0): number {
  return barHeightPx.value || fallback;
}
