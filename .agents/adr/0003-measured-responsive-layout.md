# 0003: Responsive State From Measured Widths, Not Breakpoints

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: The top bar decided its own density from CSS breakpoints — `hidden sm:inline` inside `SegmentedControl` hid the sort labels below 640px, and `h-14 md:h-16` / `px-3 md:px-6` snapped height and padding at 768px. A breakpoint answers "how wide is the viewport", which is not the question being asked. The user reported three symptoms in sequence, each exposing a different face of the same mistake: labels hidden at 320px while the pill still had room (and visible on a wide window with a long translation while nothing was tight), a visible height jump at exactly 767→768px, and a flapping bar across a boundary. Three rounds of fixing the _predicate_ failed before the real cause surfaced: the hidden copy being measured was reporting 215px against a true 258px, so the numbers were feeding back on themselves.
- **Decision**: Derive every piece of state from a **measured** value, in a pure module (`lib/components/topbarFit.ts`), with the decision function separated from the DOM. Density steps down one level at a time and only when the current level genuinely stops being comfortable. Two additional rules came out of the same work: a predicate must require **slack**, not mere fit; and hysteresis must be **asymmetric** (tighten on slack, loosen only past a wider band).
- **Consequences**:
  - The bar is gradual by construction. Height is a linear ramp over 480→1600px and the value is **not rounded**, because an 8px ramp has `8 × dpr` resolvable positions — 27 on the reference phone (density 540) versus 8 on a dpr-1 desktop, where rounding would discard the extra precision for nothing.
  - Padding became a **constant** rather than a ramp: `px-3 md:px-6` measured too roomy on desktop, drifting the controls off the window edge. Removing the ramp also removed a second breakpoint.
  - Layout invariants the user cares about (which controls are visible at a given width) are now **unit-testable** without a browser, and the same suite caught a real one-way bug that only the widening direction exposes.
  - Cost: measurement probes are unavoidable, and they are easy to get wrong in three specific ways (hidden-copy widths, probe placement, zero-slack fit) — all recorded in `MEMORY.md` under "Responsive Layout".
  - Cost: `ResizeObserver` + rAF per resize. Coalesced, and cheap relative to the reflow it avoids.
- **Alternatives considered**:
  - _Keep breakpoints but add more of them_: rejected — this is what produced the bug; more breakpoints means more places where the bar can be wrong, and the wrongness is invisible until a user resizes.
  - _A single container query (`@container`) driving the same rules_: rejected — still breakpoint-shaped; the container's width is not the question, the space the controls need is.
  - _Pure CSS only, no measurement_: rejected for the same reason; there is no CSS mechanism for "this pill is squeezed".
  - _Drop the responsive behaviour entirely and use one fixed layout_: rejected — the user wants continuous adaptation, and a single layout cannot serve a 320px phone and a 1440px desktop.
