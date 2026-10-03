# Infoto Design & Component Contract

The single source of truth for how this site is supposed to look and behave. It replaces
`.ai/00-contracts.md`, deleted 2026-09-25 while already out of date (see §4.1).

**Scope rule — this file holds only what no test can enforce.** An invariant with a real
assertion behind it lives in code and is listed in §5. Engineering rules, red lines and
layer boundaries stay in `AGENTS.md`. Decision history stays in `.ai/adr/` (read-only
history). Pitfalls stay in `.ai/memory/`.

## How to use this file

1. **A visual decision that is not written here is not authorized.** If it is absent,
   either add it here first or do not make it.
2. **Changing a value in §1 obliges the same commit to change the table.** §5 asserts the
   two are equal, so a one-sided edit fails `npm test`.
3. **Anything that was wrong once and got corrected earns a ⚠️ entry in §4.** Read §4
   before "simplifying" something that looks over-engineered.
4. **§3 is still being back-filled from the commit history.** Sections tagged
   `TODO(contract)` are known gaps — a gap is not permission to invent.

---

## 1. Tokens

Declared once in `web/src/app.css` under `@theme`. `web/src/base/lib/motion.ts` mirrors
the motion subset for JS, because Web Animations / Svelte transitions / timers cannot read
a CSS custom property; the mirror carries fallback values only and is asserted equal to
this table.

### 1.1 Colour, radius, motion, shadow

| Token                          | Value                               | Use                                                      |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------- |
| `--color-background`           | `#0a0e1a`                           | Page background                                          |
| `--color-foreground`           | `#e2e8f0`                           | Primary text                                             |
| `--color-muted-foreground`     | `#7b85a0`                           | Secondary text                                           |
| `--color-card`                 | `#0f1524`                           | Base panel: cards, sidebars                              |
| `--color-popover`              | `#151c2e`                           | Raised panel: menus, upload progress                     |
| `--color-surface-top`          | `#1a2238`                           | Topmost layer: toasts, front-most dropdowns              |
| `--color-muted`                | `#151c2e`                           | Muted fill; same value as `--color-popover`              |
| `--color-primary`              | `#22d3ee`                           | Theme cyan. Always solid, never a gradient               |
| `--color-primary-foreground`   | `#042f2e`                           | Text on primary                                          |
| `--color-ring`                 | `#22d3ee`                           | Focus ring                                               |
| `--color-border`               | `#1e2640`                           | Resting border; hover `#2a3550`                          |
| `--color-input`                | `#1e2640`                           | Input border; same value as `--color-border`             |
| `--color-secondary`            | `#151c2e`                           | Secondary fill                                           |
| `--color-secondary-foreground` | `#e2e8f0`                           | Text on secondary                                        |
| `--color-destructive`          | `#f43f5e`                           | Destructive; also the `like` mark                        |
| `--color-success`              | `#10b981`                           | Success                                                  |
| `--color-warning`              | `#f59e0b`                           | Warning; also the tri-state excluded mark and `report`   |
| `--color-dislike`              | `#3b82f6`                           | Dislike, the cool counterpart to destructive             |
| `--radius`                     | `12px`                              | Generic controls, derived `rounded-lg/md/sm`             |
| `--radius-card`                | `14px`                              | Media and panel surfaces                                 |
| `--control-disabled-opacity`   | `0.4`                               | The one disabled treatment, applied by `button:disabled` |
| `--ease-enter`                 | `cubic-bezier(0.2, 0, 0, 1)`        | Entering motion                                          |
| `--ease-exit`                  | `cubic-bezier(0.3, 0, 0.8, 0.15)`   | Leaving motion                                           |
| `--ease-spring`                | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy motion                                            |
| `--duration-enter`             | `280ms`                             | Entering motion                                          |
| `--duration-exit`              | `160ms`                             | Leaving motion                                           |
| `--duration-spring`            | `420ms`                             | Bouncy motion                                            |
| `--ease-reflow`                | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Waterfall box retarget — no overshoot                    |
| `--duration-reflow`            | `450ms`                             | Waterfall box retarget — no overshoot                    |
| `--shadow-md`                  | `0 4px 12px rgba(0, 0, 0, 0.4)`     | Light popover: toast, dropdown                           |
| `--shadow-lg`                  | `0 20px 50px rgba(0, 0, 0, 0.6)`    | Heavy popover: lightbox menu, upload panel               |
| `--shadow-lift`                | `0 -8px 24px rgba(0, 0, 0, 0.45)`   | A bar pinned to the bottom edge                          |

Enter and exit are **different pairs**. A single class driving both directions runs at
enter timing on close; when both matter, derive duration and ease from the state
(`MultiSelectBar` is the worked example).

**Reflow is its own phase and must not be `spring`.** The waterfall writes
`transform` / `width` / `height` and lets a CSS transition interpolate, so an interrupted
reflow retargets mid-flight instead of restarting; `spring`'s overshoot is wrong for a box
that has to land on a computed size.

### 1.2 Token discipline

- **Never re-type a palette colour, radius or shadow in a component.** A literal does not
  follow the token it was copied from, and it is the only kind of drift no test catches.
- **JS-driven animation reads the tokens, it does not restate them.** Re-typing
  `cubic-bezier(0.2, 0, 0, 1)` in a component is how the token file and the components
  diverged once already.
- **One measurement, no re-derived formula downstream.** The top bar publishes what it
  measures: `barCssVars` emits `--bar-h` and `--bar-icon` / `--bar-badge` /
  `--bar-badge-text`, and eight `size-[calc(var(--bar-h)*0.3125)]` strings became
  `size-[var(--bar-icon)]`.
- **One disabled treatment.** Do not re-add per-site `disabled:opacity-*`, and do not
  override `button:disabled{cursor:not-allowed}`.

---

## 2. Flat visual discipline

Verified against the tree on 2026-10-03.

- **No glow anywhere on the site.** No bloom, no halo, no outer glow — everything is flat.
  There is exactly one named exception: **the glitch glyph**, whose main layer carries a
  two-stop `text-shadow` glow in the theme cyan. That exception is granted and closed, and it
  covers **both** surfaces that draw the glyph. Nothing else may glow, and the glyph's glow may
  not widen — a third stop, a different colour, or a glow on the echoes would each be drift.
  The glyph's colours, layer stack and keyframes live in `src/shared/glitch.ts`; the Worker page
  must not grow its own shadow.
- **Shadows belong to popovers only.** Cards and buttons carry no shadow. Current holders
  are `ActionSheet`, `AdminMigrateMenu`, `ErrorPage`, `OverlaySidebar`, `ReactionPicker`,
  `Tooltip`, `UploadPanel` — a shadow appearing anywhere else is drift.
- **Dark is not a theme.** The site is permanently dark; there is no theme switch, and the
  root carries `color-scheme: dark`.
- **Pill-shaped controls say `rounded-full` explicitly.** Everything else is a solid fill.
- **The glitch glyph's stylesheet is global and unlayered, on purpose.** `GLITCH_CSS` is one
  string consumed by two runtimes, so the SPA cannot scope it the way a Svelte `<style>` block
  would; `GlitchText` injects it into `document.head` during component init, before first
  paint, because the layers are stacked by absolute positioning and a frame without it shows
  them overlapping inline. Consequence to remember: **an unlayered rule outranks every
  `@layer`, including Tailwind's utilities.** The `.gf` element therefore carries no utility
  classes, and the next person to add one loses it silently. The `gf-` prefix on every class
  is what keeps the sheet from colliding; keep it.

---

## 3. Component behaviour

Back-filled from the commit history. Tagged sections are not yet written.

- **Error page.** Two surfaces draw one design, defined in `src/shared/glitch.ts`.
  - `ErrorPage.svelte` delegates to `GlitchText`, which injects the shared CSS and supplies only
    the JS half. It renders a **404 only** — both call sites (`Root.svelte:24`,
    `Admin.svelte:329`) pass `code={404}`, so it has no 5xx branch and takes no message prop.
  - `src/worker/errors.ts` inlines the same CSS and serves `notFoundPage` (arbitrary paths,
    `/admin/*`, missing or deleted `/l/:id36`) and `serverErrorPage` (`onError`), each with its
    own wording and `Accept-Language` output. JSON endpoints must return
    `{ ok:false, error:'internal' }` instead of HTML.
  - The Worker's glyph cannot burst or scramble — it has no `<script>`, so it runs the ambient
    slice/jitter only. Same layer stack, less capability.
  - The two 404 wordings differ on purpose: the SPA one is a route miss, the Worker's also
    covers a removed image — hence `spaNotFoundMessage` vs `workerNotFoundMessage`.
- **Broken media shows nothing.** A card whose media fails to load renders a bare
  `--color-card` surface — no status code, no glyph, no toast. The grid stays silent about it;
  the report is the toast the Lightbox raises when that card is opened. The earlier glitching
  `404` fallback was removed on 2026-10-04 as vestigial, and the real HTTP status was never
  obtainable cross-origin anyway, so it could only ever have been a guess.
- **Segmented sort pill.** The pill never decides its own shape — it renders `showLabels`
  as handed to it, and the **top bar** decides via `resolveBarMode`. Three modes: `full`
  (one screen, labels), `compact` (one screen, icons), `paged` (two screens, whose first
  screen is _always_ icon-only regardless of mode).
  - Two shapes, one markup. Labelled: label `<span>` is `relative`. Icon-only: the span is
    `absolute left-0 top-full invisible whitespace-nowrap` with `aria-hidden="true"`, and the
    button carries `aria-label={label}`. **The span is kept, not removed** — that is the
    measurement trap in ⚠️ §4.3, not an oversight.
  - Shell: `relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1`.
    Indicator: `absolute bottom-1 left-0 top-1 rounded-full bg-primary`, transitioned on
    `--duration-enter`/`--ease-enter`, positioned from `offsetLeft`/`offsetWidth` observed per
    button.
  - Thresholds live in `topbarFit.ts` only: `BAR_PAD = 12`, `BAR_MIN_SLACK_PX = 12`,
    `BAR_HYSTERESIS_PX = 24`. Climb while the candidate fits with 24px spare; drop while the
    current mode has under 12px slack; otherwise keep. `available <= 0` or non-finite → `full`.
    Hysteresis must stay asymmetric (§ `MEMORY.md` Responsive Layout).
  - Structural gap counts are written down and must track the markup: **3 / 3 / 2** for
    single, paged-first, paged-second. The gap itself is _measured_
    (`getComputedStyle(rowEl).columnGap`), never assumed.
  - Measurement contract: `pillMeasure` reports `shown` (the live tablist rect), and
    `labelDelta` = width of the _opposite_ shape − `shown`. The opposite shape is a
    `cloneNode(true)` re-shaped into normal flow at `width: max-content`, appended to
    `document.body` — never inside the header, where an absolute twin becomes the containing
    block for the paged track and drags both screens off-screen. Every span is stripped and
    rebuilt from the button's `title`, which is the only lossless copy of the label text.
  - Re-measure triggers: mount, a `ResizeObserver` on the observed node (rAF-coalesced to one
    measurement per frame), and `update()`. `TopBar.remeasure()` bails unless _every_ measured
    width is non-zero, and also runs from the header observer, `window.resize` and a 250ms
    timer — a language switch resizes the pill but not the header, so nothing else would.
  - The pager arrow lives on **both** screens, at each screen's outer edge; a single-screen
    pager leaves the other screen with no way to switch.
  - **Nothing asserts any of this.** `pillMeasure.ts` has zero tests, and on the `SortTabs`
    path its report is discarded because that component takes no `onWidths`.
- **Waterfall card.** The card positions itself at `0,0` and moves purely by transform; its
  box arrives entirely as props.
  - `tight` = `width < 140 || height < 64`. There are exactly two density shapes and no third.
    Tight shrinks badge padding, font size and icon, the checkbox, the volume button and the
    badge row's gaps and offsets.
  - Media UI is _derived_ from `loadedUrl === photo.url`, never from an object-identity
    comparison, so a `/sync` swap cannot blank a loaded image.
  - Overlay states: `undefined` renders nothing; `{ fraction }` draws a `bg-black/70` veil whose
    height is `(1 - min(fraction, 0.9)) × 100%` on `--duration-exit`/`--ease-exit`, plus a
    dismiss control top-right; `{ failed: true }` covers with `bg-black/75`, a centred retry and
    a danger dismiss. **The veil can never fully clear while an overlay exists**
    (`CURTAIN_MAX_OPEN = 0.9`) — a fully transparent curtain would read as no progress at all.
    Every overlay control calls `stopPropagation()`, so it can never reach the card's own click.
  - The selection checkbox is a non-interactive `<div>` — selection is driven by clicking the
    card root. It sits above the media and below the curtain.
  - Marks: like = `destructive`, dislike = `dislike`, report = `warning`. The viewer's own mark
    is filled; everyone else's is the same hue at 60%. "Active" means `selfId` is in the
    corresponding array — ownership, not a separate flag. Badges are
    `bg-black/55 text-white/75 backdrop-blur-sm`, transitioned on the exit pair, and each stops
    propagation.
  - The volume button exists only for `photo.type === 2 && !loadFailed`. Its size is an inline
    style (1.25rem / 1.9rem), and `volumeMuted` is component-local, starts `true`, and is
    neither persisted nor sent anywhere.
  - **Density:** only the `shortest` strategies turn band into a count —
    `count = max(1, round((cross + gap) / (band + gap)))`. The `sequential` strategies read
    `band` as a target thickness and justify a filled row to exactly fill `cross`. Zoom
    (0.5–2) multiplies both band and gap.
  - Canvas: `padX = clamp(8, 16, round(containerW × 0.02))`; `padTop = ceil(--bar-h)` with
    `TOP_GAP = 0`, falling back to the ramp value only before the bar has measured.
  - **Virtualization is a state-lifetime contract.** The window is
    `[scroll − viewport×2, scroll + viewport×3]` (`bufferScreens = 2`) and the `{#each}` is keyed
    by `box.id`, so cards are **destroyed** on scroll-out. Per-instance state (`loadedUrl`,
    `volumeMuted`) is therefore lost and the fade-in replays on return — intended for the
    former, a real loss for the latter. Geometry is deliberately carried across the unmount;
    ⚠️ §4.4 is the model, and it is the reason a remount can glide at all.
  - **Reflow rides `transform` / `width` / `height` on `--duration-reflow` / `--ease-reflow`**
    and nothing else. `border-color` and `opacity` stay on the exit pair — they are hover and
    selection state, not geometry. A card's start box comes from `WaterfallLayout`'s
    `geomMemory`, never from its own state.
  - Failed uploads are excluded from preview and from selection.
  - **Nothing asserts any of this**, and `WaterfallLayout`'s `overlays` prop type is narrower
    than the value the store actually passes (`preview` is missing from the declared type).
- **Lightbox.** The action sheet is a **bottom sheet**, not a dropdown — a dropdown's top-right
  anchor is outside a thumb's reach on a phone.
  - Seven actions in a three-column grid, each a distinct hue. This is a scanning cue and is
    deliberate (⚠️ §4.5): copy original = `sky`, copy link = `violet`, share = `teal`, Lens =
    `primary`, report = `amber`, download = `success`, delete = `destructive`. Four of those
    seven are raw Tailwind palette values rather than project tokens; only Lens/download/delete
    are tokens. A hover background is required on every action, or the row reads as inert.
  - **Paging wraps around**; it does not clamp. First and last are connected. Both arrows are
    `disabled` below two photos, and both navigation functions no-op in that case.
  - Clicking the stage left/right of centre pages; it ignores every interactive target and is
    suppressed while a menu is open or a gesture has moved.
  - **Swipe and `ArrowLeft`/`ArrowRight` are not paging.** They set a mark (like/dislike) and
    auto-advance after 200ms. Marks made by gesture are one-way — repeating does not cancel;
    only the top-bar buttons toggle. `ArrowUp` opens the menu, `ArrowDown` downloads, `Space`
    toggles volume for video only.
  - Swipe thresholds are viewport-scaled from a 768px reference: 60px to trigger, 10px to show
    the direction hint.
  - Zoom is `Ctrl` + left-drag (mouse only, inside the media box) and pinch/two-finger on touch;
    the **wheel** and double-click/double-tap also work; all clamped to **0.5…5**. The lower
    bound is below 1 **on purpose**: pinch-apart and wheel-up must be able to make the
    media smaller than the stage, which is the only way back to a whole-photo view once a pinch
    has gone too far. With a floor of 1 both inputs were live but inert — they computed a value,
    clamped it straight back to 1, and nothing moved. "Zoomed in" therefore means
    `!isAtRest(scale)` (above 1.01), **never** `scale > MIN_SCALE`: a 0.8 image is smaller than
    the stage, so it centres and refuses to pan exactly like a 1.0 one does. Pinch and double-tap
    zoom **around the gesture point** (the two-finger midpoint, or the cursor for wheel/double-click),
    recomputed every frame from the gesture-start state so there is no cumulative drift. The
    **wheel zooms on any wheel event** (trackpad pinch arrives as `Ctrl`+wheel) anchored on the
    cursor — `Ctrl` is no longer required for wheel zoom. Double-click/double-tap easing is on
    (`zoomToPoint(..., animate=true)`). Two-finger pinch **and `Ctrl`+drag both rotate**:
    `Ctrl`+drag treats the card centre as a fixed pivot — the pointer's distance from it drives
    scale and its angle around it drives rotation (the image scales and spins about the stage
    centre, never drifting) — so desktop gets the same zoom+rotate the touch pinch has. `Ctrl` may
    be pressed **any time**: held at press _or_ pressed mid-drag (the plain drag switches into the
    `Ctrl` mode on the `Control` keydown, and the `Control` keydown no longer resets the zoom,
    which used to fight "press Ctrl to begin"). **Both** touch pinch and `Ctrl`+drag rotation snap
    to the nearest 90° on release (kept as a signed value so a −90° gesture does not spin a full
    turn) — the desktop path had been missing the snap. Rotation survives zoom resets (double-tap,
    double-`Ctrl`) and is only cleared on a photo switch. Panning (and rotation) is
    gated on the **rendered media actually exceeding the viewport** (`isZoomedBeyondViewport`)
    or being rotated — not on a bare scale comparison — so a small image zoomed to, say, 1.3×
    (still smaller than the viewport) no longer enters pan mode. A rotated image stays pannable
    **even at fit scale** (a pure rotation leaves `scale = 1` but its bounding box can overflow the
    stage), so `clampPan` force-centres only when at fit _and_ unrotated; otherwise it bounds the
    offset by the rotated box's overflow. Panning is rect-based and bounded
    by **half the overflow on each axis**: a media box larger than the stage may move until an
    edge meets the stage edge, while one still smaller than the stage is held centred rather than
    slammed into a corner — the two "no gap" edge conditions can never both hold for a
    sub-viewport box, and applying both pinned it bottom-right. The clamp runs **after** the
    transform write, against the freshly rendered rects (`clampSettled`); clamping the previous
    frame's rect measured geometry that was already legal, so the new value escaped unclamped on
    every move. **A pinch end writes the snapped rotation before clamping** — snapping moves the
    box's edges by tens of pixels, so clamping against the pre-snap rect is how the image settled
    out of frame at an angle it was no longer being rendered at.
    The transform is written **directly to the DOM**, not through component state, and the
    counter-scaled corner control gets the identical transition string. A pinch ends on the first
    finger lift and is guarded so it never falls through to a four-way swipe. Zoom resets on every
    photo switch.
  - **`pointercancel` is not `pointerup`.** A cancelled gesture (incoming call, edge-back, app
    switch, a second pointer stealing it) drops the gesture state, snaps any in-flight rotation to
    a resting angle, and returns the transform **without animating**. It must never reach the
    completion path: marking a photo is a server write, so routing a cancel through `onPointerUp`
    let the system hand the user a vote, a download or a menu they never asked for.
  - All gesture/transform math (zoom-to-point, pinch, `Ctrl`+drag, pan clamp, overflow gate,
    rotation snap, double-tap/swipe/click-nav classification) lives in the pure module
    `web/src/base/lib/lightboxEngine.ts` and is covered by `web/tests/unit/lightboxEngine.test.ts`
    — the `<Lightbox>` component only wires events and writes the transform to the DOM.
  - **Mask paging is hit-tested, not target-tested.** The stage captures the pointer, so
    `event.target` on the resulting `click` is always the stage; `handleStageClick` therefore
    resolves the point with `document.elementFromPoint` (which honours the zoom transform) and
    refuses to page over the media wrapper (`data-lb-media`) or any control (`button`, `a`,
    `[data-lb-controls]`, …). Target-based testing paged on a click anywhere on the card.
  - The **up gesture clears its own hint** before opening the sheet. It is the one direction with
    no auto-advance timer, so nothing else cleared it and the "more" hint stayed on screen behind
    the sheet that had just opened.
  - The **auto-advance timer is keyed on `open`/`currentIndex`, never on the photo object.**
    Marking a photo replaces its store entry while keeping its sha, so a `photo`-keyed effect
    re-ran (the derived object identity changed even though the value read did not) and cleared
    the pending 200ms advance: a swipe marked the photo but sometimes never paged until the next
    swipe.
  - Sizing is one formula shared by media and skeleton: width
    `min(var(--w), 100vw − 2.5rem, (100dvh − 8rem) × var(--ar))`, widening to 8rem/9rem at
    ≥768px. `--w`/`--ar` come from photo metadata, the media element carries no width/height
    attributes, and `object-fit: contain` does the rest.
  - While the menu is open, `Escape` and any arrow close it and `preventDefault()`; **every other
    key is swallowed without `preventDefault()`** so it still bubbles, because the photo must not
    move behind a suspended menu.
  - Reduced motion is handled **only** by the global rule in `app.css`. The Lightbox has no local
    handling, which means the JS timers (200ms auto-advance, 250ms hint clear, 350ms tooltip
    delay) still run.
  - Adjacent neighbours are preloaded with `new Image()`, wraparound, images only.
  - **The geometry lives in `base/lib/lightboxEngine.ts`, and it is covered; the wiring is not.**
    The component keeps only event handling, DOM writes and the elements the engine's rects are
    read from. `lightboxEngine.test.ts` asserts the clamp, the anchor maths, the pinch
    recomputation, the Ctrl-drag emulation and the tap/swipe/click classifiers — 15 cases. What
    remains unasserted is everything that needs a live DOM: that the engine is actually called on
    the right events, and the sizing formula. The e2e suite asserts the sheet's colours and
    hover, the counter between the arrows, wrap-around paging, and Ctrl-drag zoom — but not
    pinch, double-click, wheel zoom, swipe, any key binding, or the sizing formula.
- **Sidebar / overlay stack.** `base/lib/overlay.ts` is the **only** owner of focus trapping,
  Escape and scroll locking. `OverlaySidebar`, `ActionSheet` and `Lightbox` all use it.
  - The stack is last-in-first-out; a handler acts only when its own node is on top.
  - Listeners exist only while a layer is active: `keydown` on `document` in **capture**,
    `focusin` in bubble.
  - Escape calls `preventDefault()` and `stopImmediatePropagation()` before closing — the
    latter is what stops lower layers from seeing the same key. **One exception:** if the layer
    contains an open native popover, Escape is left to that popover.
  - Initial focus order is `[data-autofocus]` → first focusable → the node itself, always with
    `preventScroll`, scheduled in a double rAF so it lands after the opening transition starts.
    "Focusable" excludes disabled elements, anything inside `[inert]`, zero-client-rect nodes
    and computed `visibility: hidden`.
  - Tab wrapping is manual, in both directions, and re-wraps when focus sits outside the list.
  - On deactivation, focus returns to the previously focused element only if it was the top
    layer, is still connected, and is not inside an `[inert]` subtree.
  - Scroll lock is **stack-depth based, not per node**: the previous `body` overflow is saved on
    first activation and restored only when the stack empties, so closing an inner sheet does not
    unlock the page underneath it.
  - The action sets **no** `inert` and no `aria-hidden` — components own those themselves
    (`OverlaySidebar` sets both on its own root).
  - **Nothing asserts any of this**; `overlay.ts` has no test at all.
- **Upload overlay.** `UploadPanel.svelte` is the only upload overlay.
  - Panel rows exist only for phases in `PANEL_STAGES = {queued, lease-wait, transcoding,
hashing}`. `uploading` and `failed` appear on the **card**, not as rows.
  - `indeterminateRow` is true when the phase is `queued` or `lease-wait`, **or** when the
    fraction is `null`. An indeterminate row carries no `aria-valuenow` and sweeps.
  - `batchProgress` returns the mean of the measured rows **only if every row measures itself**;
    otherwise `null`, which renders as a sweep. A total that quietly omitted an unmeasured stage
    would state a number the work does not support — this is ADR 0002 in code, not a convention.
  - The header's `{done}/{total}` pair appears only when `total > 0`.
  - Hover expands the row list; on touch, dragging controls the panel's height. Collapsed, the
    batch total rides the bottom edge.
- **Admin layout.** The admin main area insets with `pt-[calc(var(--bar-h, 3.5rem)+16px)]` — it
  derives from the bar like every other surface beneath it. The fixed `pt-20`/`md:pt-24` form
  predates the height ramp and is gone.
  - The bar publishes `--bar-h`, `--bar-icon`, `--bar-badge` and `--bar-badge-text`. Consumers
    read those variables; they never re-derive a size from the bar height. One measurement, no
    downstream formula.
  - The ramp is `barHeight(barWidth)`, 56→64px across 480→1600px of bar width, and is
    deliberately **not** rounded (a CSS pixel maps to `dpr` device pixels).
  - The waterfall's `padTop` reads the same `--bar-h` with `TOP_GAP = 0`.
  - Nothing asserts the admin inset.

---

## 4. ⚠️ Corrected mistakes — do not repeat

### 4.1 The contract was deleted while already stale

`6b0bf78` ("visual rework and feedback rounds 1-9", 09-25 08:40) changed five palette
values. `f370fc0` deleted this file's predecessor at 11:45 the same day **without
reconciling them**, on the grounds that it was "basically implemented". The five values
that differ from the old table — `--color-card`, `--color-popover`, `--color-surface-top`,
`--color-primary-foreground`, `--radius` — were decided in that round and are now current.
Nobody can tell whether any of them was deliberate, because the document that would have
said so was deleted in the same day. **Implementation is not verification.** A spec is
stale the moment the code it describes moves, not when it is finished.

### 4.2 The gradient whitelist was dropped, not repaired

The old contract allowed exactly three gradients site-wide: the photo card's bottom
information mask, the empty-state illustration, and the brand mark. It had rotted — the
card mask no longer exists (`PhotoCard.svelte` has no gradient), the brand mark could not be
located, and an unlisted fourth had appeared (`--shimmer-gradient`, `Lightbox.svelte:1020`).

**Decided 2026-10-03: the rule is deleted outright** rather than re-registered. A whitelist
whose entries can no longer be matched to anything in the tree is not a constraint, it is
decoration that reads as enforcement. Gradients are governed only by the token table — a
gradient must be built from declared tokens, and `--color-primary` is never one (§1.1).

**Do not restore this rule from the old contract's text.** If a gradient needs reviewing,
review that one gradient.

### 4.3 "Hidden copies lie about width" — the fourth time

A hidden-but-present label resolves its width against the wrong containing block, so
measuring it under-reports and drifts with padding. This has now been hit three times in
the top bar (`MEMORY.md` §Responsive Layout) and once more in the segmented pill
(`50848c1`), where the compact shape hides its spans with `absolute invisible` instead of
removing them, so "spans exist" could not mean "already labelled" and the clone measured
icon width as labelled width and flapped forever at the collapse threshold.
**When a layout decision is wrong, suspect the input first.** Two different readings of
one state means the input is broken, not that the predicate needs tuning. Patch the
measurement, never the threshold.

### 4.4 The waterfall reflow has been rewritten four times, and the unmount model is settled

`a62c833` fixed the FLIP start frame, `ca1b082` abandoned WAAPI for CSS transitions so an
interrupted reflow retargets instead of restarting, a third approach replaced the animation
with the transition, and the fourth added the missing source of the start frame.

The model gap behind all of them: **the virtualizer unmounts off-screen cards, so a card that
remounts has no previous box to glide from.** A card cannot remember its own old box — the
component holding it was destroyed. So the memory has to outlive the component.

**Resolved 2026-10-04.** `WaterfallLayout` owns it; the card only reads it:

- `geomMemory: Map<photoId, GeomStamp>` is a plain, non-reactive map, so writing to it during
  a commit re-renders nothing. Every mounted card writes its own box from its `$effect`, and
  every layout commit prunes ids no longer in `result.boxes`.
- `reflowAt` is `performance.now()` taken inside the same `requestAnimationFrame` that commits
  the new boxes — stamped by the commit, not by when a card happened to mount.
- A card mounting within `reflowFlipWindowMs` of that stamp, whose remembered box differs from
  the one it was handed, paints at the **remembered** box, enables the transition, and only
  then retargets. Three states, not two; the middle one is the whole point.
- Those two steps are **two separate `requestAnimationFrame`s.** Collapsed into one, the
  `transition: none` lands in the before-change style and the browser skips the animation
  outright instead of running it for a frame.
- A mount outside the window, with no remembered box, or under `prefers-reduced-motion`
  appears in place.

**The window derives from the token, and that is the second half of the lesson.** It was first
written as a bare `480` — `ca1b082`'s mistake again, inside the same reflow, one commit after
ADR 0015 was written to name it. It now comes from `--duration-reflow` via
`reflowFlipWindowMs` (`base/lib/motion.ts`), and `motion.test.ts` asserts only that the window
outlasts the animation it brackets. Re-stamping the window from the commit time would also be
wrong: it answers _how long a card may be absent_, not when the layout happened.

§3's reflow rules are written from observation, not reasoning. If a rewrite is not measured on
screen first, it does not belong there.

### 4.5 A "locator hint" is not a change

`1a369a9` repainted three action-sheet icons white to make them findable; `2283d55`
reverted it ten minutes later. If a colour is going to change, that is the user's call —
make it separately, on its own, not folded into a diagnostic commit. The per-action colours
that exist now are deliberate and are a scanning cue.

### 4.6 External state is not observable from CI

The `/l/` reachability probe was added and removed three times in thirty minutes
(`c265c0a`, `4ac2636`, `1a369a9`, `2283d55`, `2004491`). What it measured — Cloudflare's
bot protection — lives in a dashboard and is toggled by hand. No amount of repository-side
iteration converges on it. Do not use CI as an oracle for state it cannot reach.

### 4.7 The waterfall reflow bypassed the motion tokens

`ca1b082` moved the card reflow to CSS transitions and hardcoded
`0.45s cubic-bezier(0.22, 0.61, 0.36, 1)` on `transform` / `width` / `height` — one commit
after `189b47a` built `motion.ts` specifically to make the tokens the single source. The
same declaration block tokenized its `border-color` and `opacity` legs and left the three
new ones literal, which is the usual shape of a bypass: tokenize what you were looking at,
keep writing literals for what you just added. The gate in §5 now rejects it.

It now has its own phase, `--duration-reflow` / `--ease-reflow`, carrying exactly the
literal's value so nothing about the motion changed. It is **not** `spring`: that overshoots,
and a box retarget must not.

Both open questions it left are now written down: the properties that ride the phase are
`transform` / `width` / `height` (§3, waterfall card), and the unmount/remount model that
supplies the start frame is ⚠️ §4.4. The token bypass itself is what
`designTokens.test.ts` now rejects.

### 4.8 The two error pages were different constructions; they now share one definition

**Resolved 2026-10-04.** They used to disagree on almost everything, and the duplication was
unguarded.

`src/worker/errors.ts` drew the glitch one way — two `::before`/`::after` copies,
`#f43f5e` against `#22d3ee`, stepped `clip-path`, `translateX(±2px…±6px)`, no shadow, degrading
under reduced motion to a static double. The SPA's `GlitchText` built a different thing: three
layers with `mix-blend-mode: screen`, cyan only, continuous ambient jitter, a hover burst to
±18px, and a `text-shadow` glow.

Only the copy and the fonts were ever shared (`shared/copy.ts`, `shared/fonts.ts`). The palette
sat as five bare hex values in the Worker string with nothing comparing it to `app.css`, and the
glitch parameters existed twice in incompatible forms.

**Now:** `src/shared/glitch.ts` owns the palette and the whole layer stack as one CSS string.
`errors.ts` inlines it; `GlitchText` injects it. Every colour is written
`var(--token, fallback)`, so the SPA resolves the token from `app.css` and the Worker falls
through to the identical hex — one text, correct in both runtimes. The two surfaces can no
longer differ without a visible diff in one file.

Two consequences worth keeping in mind:

- **The JS half cannot be unified, by construction.** The scramble-on-mount, the random idle
  burst and the hover trigger all need JavaScript, and the Worker page must ship without a
  `<script>` (`errors.test.ts` asserts there is none). The Worker's glyph therefore runs the
  ambient slice/jitter and can never burst. Same visual language, less capability — that is the
  intended end state, not an oversight.
- **Reduced motion now behaves the same on both**: the echoes are removed and the glow is
  dropped, rather than the Worker freezing a mid-glitch frame.
- **Sharing the glyph changed the Worker's typography, and one weight had to be added.**
  The glyph pins its own `font-family` (Inter) and `letter-spacing`, so the Worker page stopped
  inheriting the body's `"Space Grotesk", …` and started rendering its status code in Inter at
  `0.1em`. That is the point of one definition, but it exposed a gap that was invisible while
  the two surfaces drew their own thing: **the glyph asked for `font-weight: 800` and neither
  font query ships it** — `APP_FONT_QUERY` stops at 700, `ERROR_FONT_QUERY` at 600. Both
  surfaces were rendering _synthetic_ bold, the Worker more so than the SPA. The glyph is now
  **700**, and `ERROR_FONT_QUERY` loads `Inter:wght@400;700` for exactly this glyph
  (Space Grotesk carries every other weight the page chrome asks for). **When one definition
  is shared by two surfaces, check that both surfaces' font queries actually ship the weights
  it asks for** — `app.css` asserting a token exists says nothing about whether the glyph can
  draw it.
- **The entrance animation stays local.** `GLITCH_CSS` deliberately ships no entrance, because
  the SPA's half draws the glyph with a scramble and a shared `rise` would fight it. The
  Worker's page puts `rise` on the `.gf` container (not on one layer, so the stack enters as a
  unit) and drops it under reduced motion. The animation isolates the blend group for its
  0.6s; the `both` fill leaves `transform: none`, which is not a stacking context, so the
  echoes screen against the page background again the moment it finishes.

`GLITCH_PALETTE` is a fourth copy of five hex values and is compared against the contract table
by `web/tests/unit/designTokens.test.ts`, closing the gap that §5 used to list as open.

### 4.9 Invented values look exactly like real ones

`0x0000…00` was written into the deploy workflow as a Turnstile test secret; it is on no
Cloudflare document, so every identity creation on the test deployment failed silently
while CI stayed green (`819bf06`). Copy the vendor's published value.

---

## 5. Executable gates

The parts of this contract that are asserted by `npm test`:

| Invariant                                                                  | Enforced by                             |
| -------------------------------------------------------------------------- | --------------------------------------- |
| §1.1 table equals the `@theme` block in `web/src/app.css`, both directions | `web/tests/unit/designTokens.test.ts`   |
| `motion.ts` motion fallbacks equal the `@theme` motion tokens              | `web/tests/unit/designTokens.test.ts`   |
| `schema.sql` equals `schema-ddl.ts` byte for byte                          | `src/worker/schema-alignment.test.ts`   |
| No `transition` in `web/src` carries a literal duration or easing curve    | `web/tests/unit/designTokens.test.ts`   |
| `GLITCH_PALETTE` equals the matching `@theme` colours                      | `web/tests/unit/designTokens.test.ts`   |
| The reflow flip window outlasts the reflow duration it brackets            | `web/tests/unit/motion.test.ts`         |
| Lightbox gesture geometry: clamp, anchor, pinch, tap/swipe/click           | `web/tests/unit/lightboxEngine.test.ts` |

The bypass rule covers state transitions only. `animation` timings are out of scope on
purpose: the glitch's `steps(2)` jitter and the upload sweep's `1.3s linear infinite` are
loop timings for a decorative effect and belong to no motion phase. `0s` stays legal — it
is how a property changes instantaneously while sharing a transition list.

Known gaps, in the order they should be closed:

1. **§3 has no assertions at all**, and §3 now names which parts have none. The two with the
   most behaviour and the least coverage are `base/lib/overlay.ts` (focus trap, Escape
   ownership, scroll-lock depth) and `pillMeasure.ts` (the delta that drives the pill's shape).
   `lightboxEngine.ts` is now covered, but nothing asserts that the component calls it correctly
   — an engine can be exhaustively tested and still be wired to the wrong event.
   `web/tests/e2e/ui.spec.ts` covers some overlay and Lightbox behaviour but is excluded from CI.
2. **No screenshot baseline exists anywhere.** Appearance is the one thing with zero
   regression net, and it is the only category this contract cannot express as an assertion.
3. `pillMeasure.ts` has no unit coverage; `topbarFit.ts` has four cases including one for
   flapping, which is why it is the one that did not regress. The waterfall reflow has exactly
   one assertion — that the flip window brackets its own animation — and none at all for the
   layout itself, because that is DOM timing and belongs in the e2e suite.
4. **Two people can edit this file at once.** A parallel session rewrote §3's error-page entry
   and added ADR 0015 while this section was being written, and separately rewrote
   `Lightbox.svelte` and added `base/lib/lightboxEngine.ts` + its test while the first pass was
   still open. Re-read before a large edit, and prefer `edit` on a unique anchor over rewriting
   a whole section. **A concurrent writer will invalidate `read` results — when an edit is
   refused with "file changed since it was read", the file is not yours, and check the mtime
   before retrying rather than re-reading and re-applying blind.**

Closed on 2026-10-04: `errors.ts` no longer embeds bare hex — the glitch palette moved to
`src/shared/glitch.ts` and is asserted against the table above. Also closed: the glitch glyph
asked `ERROR_FONT_QUERY` for a weight it never shipped, so the standalone error page was
rendering synthetic bold (§4.8).
