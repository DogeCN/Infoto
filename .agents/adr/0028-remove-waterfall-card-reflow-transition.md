# 0028: The Waterfall Card Carries No Positional Transition

- **Date**: 2026-11-01
- **Status**: Accepted
- **Context**: The waterfall card had a "smooth positional motion" system: on a layout reflow
  (a scroll-remount, a settings-slider drag, a filter, a column-count change) an on-screen
  card glided from its previous box to its new one. The motion rode `transform` / `width` /
  `height` on its own motion phase, `--duration-reflow` / `--ease-reflow`, and a card the
  virtualizer had unmounted glided from a remembered start box (`geomMemory` + `reflowAt` +
  `reflowFlipWindowMs`, the FLIP model settled in ⚠️ CONTRACT §4.4). A measured flag
  (`smoothMotion`) gated it to moves the eye could follow — on screen and between neighbouring
  columns. The user asked to remove the smooth transition on the waterfall cards entirely.
  The scope was narrowed, on the user's choice, to **only** the positional glide: the media
  fade-in, the upload curtain, the selection/volume controls, and the card's hover/selection
  border cross-fade are a different kind of state transition and were kept.
- **Decision**: Delete the positional-glide system outright. `PhotoCard` writes its committed
  box (`x`, `y`, `width`, `height`) straight into the inline style with no geometry transition;
  its `.card-state` class declares only `border-color` and `opacity` on the exit pair. The FLIP
  machinery is gone: `motionMemory`, `reflowAt`, `smoothMotion`, `placed`, `fromBox`, the
  two-rAF arming effect in the card, and `geomMemory` / `reflowAt` / `columnStep()` /
  `onScreen` in `WaterfallLayout`. The orphaned `GeomStamp` type left `base/lib/layout.ts`.
  The `reflow` phase and `reflowFlipWindowMs` left `base/lib/motion.ts`, and
  `--duration-reflow` / `--ease-reflow` left `app.css`, the CONTRACT §1.1 table, and the
  motion-test token mirrors. The e2e spec `web/tests/e2e/waterfallMotion.spec.ts` — whose only
  assertions were on the now-deleted `card-motion` class — was removed with the feature.
- **Consequences**:
  - Reflow is instant and cheaper: no per-card geometry interpolation, no double-rAF per
    remount, no O(boxes²) `columnStep()` scan on every virtual-window recompute, no
    cross-mount memory map to prune on commit.
  - The `@theme` motion table is now `enter` / `exit` / `spring` only, and `motion.ts`,
    `app.css`, and CONTRACT §1.1 stay byte-equal under `designTokens.test.ts` with one fewer
    phase.
  - Removing the feature removes its only behavioural tests. The contract's §4.4 is **not**
    deleted — it is rewritten to record that the model was settled and then removed, keeping
    the two rules any re-introduction must respect (the start frame must outlive the unmounted
    component; the two rAFs stay separate; the window derives from a token, never a bare
    number). That warning is the point of keeping the ⚠️ entry rather than "cleaning it up".
  - A drag of the density/spacing slider now re-lays-out without the cards gliding; the user
    accepted this as the intent of the change.
- **Alternatives considered**:
  - _Keep the tokens but disable the transition (e.g. `prefers-reduced-motion`-style gate, or a
    `0ms` duration)._ Rejected: the user asked for a thorough removal, and a dead phase in the
    token table is exactly the "spec that silently stops being true" red line 8 forbids —
    `designTokens.test.ts` would keep asserting a pair nothing reads.
  - _Also drop the card's hover/selection border cross-fade._ Rejected on the user's explicit
    choice; that transition is state (border colour), not geometry, and predates this system.
