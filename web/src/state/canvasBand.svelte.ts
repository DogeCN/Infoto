// The auto band resolved from the waterfall's measured cross size.
//
// WaterfallLayout owns the measurement: the cross size depends on the scroll
// direction, the canvas padding and the reserved overlay footprint, none of which
// the settings panel can see. The layout publishes the resolved value here so the
// panel can show the effective width without restating the mapping against a
// width it guessed from the viewport.

/** Resolved auto band in CSS pixels; 0 until the canvas has measured itself. */
export const autoBandPx = $state({ value: 0 });
