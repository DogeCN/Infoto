/**
 * Numeric clamps shared across layers. Progress fractions, slider positions and
 * normalised ratios all mean the same thing, so they clamp the same way.
 */

/** Clamp to the 0…1 range; a non-finite input reads as 0. */
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Clamp to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
