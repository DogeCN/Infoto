// Target column width settings, in CSS pixels.

export const MIN_BAND = 200;
export const MAX_BAND = 800;
export const DEFAULT_BAND = 260;

/**
 * Default target column width for a given available (canvas) width.
 *
 * On mobile the default is half the available width, so the gallery opens as a natural
 * two-column grid that tracks orientation and resizes. On wider (desktop) viewports it
 * stays at the fixed `DEFAULT_BAND`. Both the waterfall and the settings panel call this
 * so the slider reads the same value the gallery actually renders — until the user
 * customizes the band, at which point the stored value is used directly.
 */
export function defaultBand(availableWidth: number): number {
  if (availableWidth < 768) {
    // Mobile canvas padding is padX = 12 (24 total), matching WaterfallLayout.
    return Math.min(MAX_BAND, Math.max(MIN_BAND, Math.round((availableWidth - 24) / 2)));
  }
  return DEFAULT_BAND;
}
