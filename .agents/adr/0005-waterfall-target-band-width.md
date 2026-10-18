# 0005: Waterfall Density Controlled by Target Band Width

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: The prior layout setting persisted a target pixel width. On a 320 CSS-pixel phone, the default 260px band produced one column, and the slider's 200px minimum could not reach a compact multi-column layout. A column-count preference fixed that responsive symptom but made the user's control indirect: the same count mapped to different card widths as the viewport changed. The user requested restoring the historical pixel-width control.
- **Decision**: Persist `layout.band` as the target row height / column width in CSS pixels. Default remains 260px. The slider range is 100–800px, step 10 — the floor was lowered from 200 so a phone can reach a compact multi-column view without a viewport-specific default. The layout engine derives the resulting count from the measured cross size. Bump the settings version and drop v2 column-count blobs whole; do not reinterpret one unit as the other.
- **Consequences**:
  - Users directly control target card scale; the actual number of columns still varies with available space.
  - An untouched gallery keeps the 260px default, so a narrow phone can still open at one column. Sliding to 100px is how that phone reaches a compact multi-column view, without a second viewport-specific default.
  - The persisted shape is version 3, so existing v2 settings reset to defaults.
- **Alternatives considered**:
  - _Persist a responsive column count and derive the pixel band_: rejected for this request because the setting no longer directly controls card width and identical counts produce viewport-dependent card sizes.
  - _Keep the old model but lower its minimum or add viewport-specific defaults_: rejected because it changes the historical control contract and reintroduces special responsive behavior instead of restoring the requested direct width control.
