# 0020: Auto Default Band Derived From the Measured Canvas

- **Date**: 2026-10-25
- **Status**: Accepted
- **Context**: ADR 0005 restored `layout.band` as a pixel target and kept the untouched default at 260px so that direct width control stayed literal. That default produces one column on a phone: at 320–390 CSS pixels the measured cross is roughly 304–374px, and `round((cross + gap) / (260 + gap))` stays at 1 until about 412px. A first visit on a phone therefore opened with a single oversized card instead of a usable first screen. Lowering the fixed default far enough for a 320px phone (about 190px) would turn a 1440px desktop from five columns into seven, so no single constant satisfies both ends.
- **Decision**: Persist `layout.band` as `number | null`; `null` is the untouched default and resolves per layout pass from the measured cross size:
  `autoBand(cross, gap) = clamp(MIN_BAND, DEFAULT_BAND, round((cross − gap) / 2))`.
  This is one continuous mapping — two columns fill the canvas while half of it is below the 260px reference, and the reference takes over once the canvas is wide enough. It is not a minimum-column rule: the two-column phone layout is a consequence of the mapping, and the result is monotonic across resizes. A user drag writes an explicit pixel width as before. `WaterfallLayout` publishes the resolved value through `state/canvasBand.svelte.ts`, mirroring ADR 0012, so the settings panel shows the effective width without re-deriving it from a viewport it did not measure. `SETTINGS_VERSION` 4 drops existing v3 blobs whole (project red line: reset, never migrate).
- **Consequences**:
  - A phone opens at two columns; 1440px keeps five columns at 260px; intermediate widths step through 3, 4, 6 and 7 at the same thresholds the fixed 260 default already used.
  - The default adapts to resizes and direction changes because it is resolved by the same measurement the layout consumes, not captured once at load.
  - Existing v3 settings (including filter presets) reset once on first load.
  - The slider's value in auto mode is a derived measurement: it can move with the window, and dragging it turns the value into an explicit override.
- **Alternatives considered**:
  - _Lower the fixed default to 180–200px_: rejected — the desktop gains columns nobody asked for, and 320px still falls to one column at 200px (`round(316 / 212) = 1`).
  - _Enforce `max(2, columns)` in the layout engine_: rejected — it is a special case rather than a mapping, and it would override an explicit 800px band on a narrow screen, breaking the direct-control promise of ADR 0005.
  - _Persist a column count and derive the width_: already rejected by ADR 0005; identical counts still produce viewport-dependent card sizes.
  - _Derive the default once at load and persist the number_: rejected — a window opened narrow and then maximized would stay permanently dense, and the reset button would need a second source for the same value.
