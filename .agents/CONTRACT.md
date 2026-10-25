# Infoto Design & Component Contract

The single source of truth for how this site is supposed to look and behave. It replaces
`.agents/00-contracts.md`, deleted 2026-09-25 while already out of date (see §4.1).

**Scope rule — this file holds only what no test can enforce.** An invariant with a real
assertion behind it lives in code and is listed in §5. Engineering rules, red lines and
layer boundaries stay in `AGENTS.md`. Decision history stays in `.agents/adr/` (read-only
history). Pitfalls stay in `.agents/memory/`.

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
  diverged once already. The executable gate only scans `transition:` declarations, so
  three blind spots stay on discipline alone: WAAPI keyframe options use
  `motionMs(phase)` / `motionEase(phase)`, Svelte `transition:` params use
  `motionMs(phase)` / `motionEaseFn(phase)` (see `bubbleTransition`), and a Tailwind
  `transition-*` utility pairs `duration-[var(--duration-*)]` with
  `ease-[var(--ease-*)]` — a duration without its ease falls back to Tailwind's default
  curve, and a bare utility falls back to 150ms at a curve no phase declares.
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
- **A media link resolves with one trailing slash.** `GET /l/:id36` is registered under both
  forms, because a copied link is often pasted as `/l/19/` and the SPA fallback already normalizes
  trailing slashes for its own routes. Without it the Worker answered its own 404 for a link that
  names an existing photo; the asset layer is not involved (`run_worker_first` already routes
  `/l/*` here). A second slash is not handled — no path the app hands out produces one.
- **Broken media shows a glitching 404.** A card whose media fails to load renders the same
  `GlitchText` the error page uses, over a `--color-card` surface, and still opens the Lightbox,
  which raises a failure toast of its own. The size is a container-query expression with a
  breakpoint at 140px card width: `clamp(0.65rem, 14cqmin, 0.85rem)` below it,
  `clamp(1.25rem, 22cqmin, 3.5rem)` above. **The number is a label, not a measured status** —
  media is fetched cross-origin, where an `<img>`/`<video>` error event carries no HTTP status
  and `fetch()` can only return an opaque response. It is read as "this file cannot be shown".
  This fallback was removed on 2026-10-04 (in a commit about reflow motion, which is why the
  deletion and the contract entry describing it were easy to miss) and restored on 2026-10-19:
  a failed card with no marker is indistinguishable from one that has not loaded yet, and the
  silent version shipped alongside a transcode defect that blanked every uploaded GIF — with
  nothing in the grid to say so. Removing it again needs a replacement indicator, not deletion.
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
    rebuilt from the button's `data-label`, which is the only lossless copy of the label text.
    It is a data attribute, **not `title`**: the tabs' tooltips are the custom component now,
    and a measurement must not depend on a tooltip's attribute to work.
  - Re-measure triggers: mount, a `ResizeObserver` on the observed node (rAF-coalesced to one
    measurement per frame), and `update()`. `TopBar.remeasure()` bails unless _every_ measured
    width is non-zero, and also runs from the header observer, `window.resize` and a 250ms
    timer — a language switch resizes the pill but not the header, so nothing else would.
  - The pager arrow lives on **both** screens, at each screen's outer edge; a single-screen
    pager leaves the other screen with no way to switch.
  - **Nothing asserts any of this.** `pillMeasure.ts` has zero tests, and on the `SortTabs`
    path its report is discarded because that component takes no `onWidths`.
- **Tooltips are always the custom component.** Every hover hint is `Tooltip.svelte`, or
  `TooltipIconButton.svelte` when the trigger is an icon button (it takes the text once, as
  both tooltip and `aria-label`; `ariaLabel` overrides when the spoken name is longer, and
  `ariaPressed` publishes toggle state). A native `title` is **never** used as a tooltip: it
  renders in OS chrome, never appears on touch, and carries none of the `aria-describedby`
  wiring. There are two `title` attributes left in the app and neither is a tooltip — the
  `OverlaySidebar` `title` prop, which names the dialog.
  - **`TooltipIconButton` is the one icon-button trigger, and it always applies `icon-button`.**
    It carries the shared base (rounded, muted text, primary hover tint, 0.96 press scale), so a
    call site supplies only what differs in `class` — size, rounding, colour tail. Its own
    escapes are `popoverTarget` (a button that opens a popover instead of an `onclick`),
    `bindElement` (a caller that anchors something to it, like `ReactionPicker`) and
    `autofocus` (the overlay focus trap's `[data-autofocus]`). ⚠️ Hand-writing
    `Tooltip + button` where `icon-button` would fit reintroduces a second button treatment that
    the design tokens do not describe; `Tooltip` alone stays for a trigger that is not an icon
    button (a link, a resize handle, a labelled pill).
  - The wrapper is `display: contents`, so it is never a containing block (an absolutely
    positioned trigger keeps its own positioning) and never changes a measured width: the
    top-bar probes measure their group **containers**, whose widths sum the same children.
  - Touch deliberately gets nothing: `canHover()` from `base/lib/device.svelte.ts` (the one
    shared `(hover: hover)` signal) short-circuits both `show` paths, so a tooltip can never
    be the only way to learn what a control does — the `aria-label` is.
  - **Only hover and keyboard focus raise a tooltip.** The focus path additionally requires
    `:focus-visible`, because focus lands on controls for reasons the user did not choose:
    the browser focuses a button on mousedown, an overlay's `focusFirst()` focuses its
    `[data-autofocus]` node, and closing a dialog restores focus to the trigger. All three
    used to pop a bubble with the pointer parked across the screen (see ⚠️ §4.10).
    `:focus-visible` is false for those and true for Tab, which is the modality that earns a
    tooltip. The residual case is deliberate: closing a sheet with Escape is keyboard-driven,
    so the restored trigger does show its bubble, telling the user where focus went.
  - **One tooltip at a time.** A module-level slot holds the open instance's closer, and a
    revealing tooltip closes whichever one holds it. Without that, hovering one control while
    focus sat on another left two bubbles on screen, each instance blind to the other.
  - The tooltip follows its trigger while open (scroll, resize, sidebar drag) and flips to the
    opposite side when the preferred one has no room; placement is fixed-positioned above
    `<body>` via `portal`, so overflow clipping and transformed ancestors cannot trap it.
- **Waterfall card.** The card positions itself at `0,0` and moves purely by transform; its
  box arrives entirely as props.
  - `tight` = `width < 140 || height < 64`. There are exactly two density shapes and no third.
    Tight shrinks badge padding, font size and icon, the checkbox, the volume button and the
    badge row's gaps and offsets.
  - Media UI is _derived_ from `loadedUrl === photo.url`, never from an object-identity
    comparison, so a `/sync` swap cannot blank a loaded image.
  - Overlay states: `undefined` renders nothing; `{ fraction }` draws a `bg-black/70` veil whose
    height is `(1 - min(fraction, 0.9)) × 100%` on `--duration-exit`/`--ease-exit`, plus a
    dismiss control top-right; `{ failed: true }` covers with `bg-black/55`, a centred retry and
    a danger dismiss. **The veil can never fully clear while an overlay exists**
    (`CURTAIN_MAX_OPEN = 0.9`) — a fully transparent curtain would read as no progress at all.
    Every overlay control calls `stopPropagation()`, so it can never reach the card's own click
    — dismiss would otherwise remove the card and then open it, and retry would open the
    Lightbox on media that does not exist. The card's click handler also refuses an
    `undefined` photo: the laid-out boxes are debounced and can outlive the photo that an
    overlay action just removed.
  - The selection checkbox is a non-interactive `<div>` — selection is driven by clicking the
    card root. It sits above the media and below the curtain.
  - **Multi-select hides both dismiss controls, and only them.** The uploading cancel and the
    failed card's dismiss both live in the card's top-right corner, where the checkbox now goes,
    so both are `!multiMode`. The failed card's **retry stays** — it sits in the middle of the
    card, nowhere near the corner. Both return when the mode does.
  - Marks: like = `destructive`, dislike = `dislike`, report = `warning`. The viewer's own mark
    is filled; everyone else's is the same hue at 60%. "Active" means `selfId` is in the
    corresponding array — ownership, not a separate flag. Badges are
    `bg-black/55 text-white/75 backdrop-blur-sm` and are **display only**: the card reports the
    counts (`role="img"` with a plural `{count} like(s)` label) and every mark is made from the
    Lightbox, where the control is a real button. There is no hover state to promise a click.
  - The volume button exists only for `photo.type === 2 && !loadFailed`. Its size is an inline
    style (1.25rem / 1.9rem), and `volumeMuted` is component-local, starts `true`, and is
    neither persisted nor sent anywhere.
  - **Density:** only the `shortest` strategies turn band into a count —
    `count = max(1, round((cross + gap) / (band + gap)))`. The `sequential` strategies read
    `band` as a target thickness and justify a filled row to exactly fill `cross`. Zoom
    (0.5–2) multiplies both band and gap.
  - **`layout.band` is `number | null`; `null` is the untouched default and follows the canvas**
    (ADR 0020). It resolves per layout pass as
    `autoBand(cross, gap) = clamp(MIN_BAND, DEFAULT_BAND, round((cross − gap) / 2))` — one
    continuous mapping, not a minimum-column rule, so a phone opens at two columns and a wide
    screen keeps the 260px density. A slider drag writes an explicit width and stops following.
    `WaterfallLayout` publishes the resolved value through `state/canvasBand.svelte.ts` (the
    `state/barHeight.svelte.ts` pattern), and the settings slider shows it as its default; it
    must not be re-derived from a viewport the panel did not measure.
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
  - **Two failure kinds, two outcomes.** A **transcode** failure leaves no card at all: the
    encoder aborts its partial artifact, the source is a Blob that died with the page, and the
    job's resume record is deleted — so there is nothing to preview and nothing for a retry to
    reuse. Its whole report is the error toast. An **upload** failure keeps its card: stage 1
    already put an artifact in OPFS, so the card previews it, a retry skips transcoding, and
    the resume record is kept (marked `failed`) so **the card survives a reload** instead of
    vanishing into a toast nobody saw. `rendersCard` in `core/pending.ts` is the one rule, and
    `sw.ts`'s `failJob` / `resumePendingUploads` mirror it on the worker side: a record with
    `failed` is rebuilt as the failed card, while only a record without it resumes on its own
    (that is an upload interrupted mid-transfer, not one the facade rejected).
  - **The upload that _succeeds_ has a third fate, and it is the one that used to be invisible.**
    Once the facade returns a URL the job is finished: the resume record is deleted and the card
    lives only in the upload store's memory, so a reload left the photo hosted and paid for with
    nothing on screen while its `upload` op sat in the log. That case is not a failure and gets
    no failure UI — it renders as an op-derived card (see the §3 Upload overlay bullet), which is
    the same card a `done` job leaves behind: plain media, no curtain, no controls.
  - Failed uploads are excluded from **preview** only. They are selectable like any other card —
    clicking one no longer opens the Lightbox (there is nothing to look at), but multi-select,
    long-press, marquee, `selectAll` and Ctrl+A all reach them, which is what makes the batch
    "delete" the way out of a stuck upload. The failure cover is `bg-black/55`, matching the
    uploading curtain's own weight: a failed card is still a card in the grid, not a hole in it.
  - **What is asserted, and what is not.** `photoCard.test.ts` holds the failure glyph and its
    container sizing; `uploadPreview.test.ts` holds that the preview comes from OPFS and not the
    pick; `pendingPhoto.test.ts` holds `rendersCard` across every phase and the op-log
    projection; `pendingUploadCards.test.ts` holds that an unconfirmed batch still reads as cards
    after a failed sync and that a confirmed one retires them. The overlay's own
    geometry, layering and curtain arithmetic are asserted nowhere.
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
    turn) — the desktop path had been missing the snap. The snap eases via the **Web Animations API**, not the inline CSS `transition`: a pinch's surviving
    finger is armed for panning and `isRotated()` is true even at 90°, so any stray move rewrites the transform with `transition:'none'` and cancels a
    CSS-transition ease mid-flight — which is exactly why a two-finger rotate sometimes snapped with no easing, depending on whether the leftover finger
    twitched within the exit-phase settle (`motionMs('exit')`, currently 160ms — the WAAPI options read the
    tokens, they do not restate them). WAAPI composites over the inline style, so the pan writes that follow cannot kill the ease; the rotation settles and
    only then does the panned position take over. A new gesture cancels any in-flight snap (see `snapWithEase` / `onPointerDown`). Rotation survives zoom
    resets (double-tap,
    double-`Ctrl`) and is only cleared on a photo switch. Panning (and rotation) is
    gated on the **rendered media actually exceeding the viewport** (`isZoomedBeyondViewport`)
    or being rotated — not on a bare scale comparison — so a small image zoomed to, say, 1.3×
    (still smaller than the viewport) no longer enters pan mode. A rotated image stays pannable
    **even at fit scale** (a pure rotation leaves `scale = 1` but its bounding box can overflow the
    stage), so `clampPan` force-centres only when at fit _and_ unrotated; otherwise it bounds the
    offset by the rotated box's overflow. The clamp is bounded by **half the overflow on each
    axis**: a media box larger than the stage may move until an edge meets the stage edge, while
    one still smaller than the stage is held centred rather than slammed into a corner — the two
    "no gap" edge conditions can never both hold for a sub-viewport box, and applying both pinned
    it bottom-right. **The clamp reads the wrap's layout box (`offsetWidth`/`offsetHeight`), never
    its rendered rect.** A rendered rect follows the transform, and every eased zoom writes the
    transform and clamps within the same frame, before the transition has interpolated: the rect
    therefore still describes the _previous_ scale, every bound collapses to 0, and the anchor
    `zoomToPoint` had just computed is discarded — a double tap off-centre zoomed about the centre
    instead of the tapped point. The clamp still runs **after** the transform write
    (`clampSettled`), which matters for the unanimated frames for the mirror-image reason.
    The transform is written **directly to the DOM**, not through component state, and the
    counter-scaled corner control gets the identical transition string. Zoom resets on every
    photo switch.
  - **A pinch owns the whole multi-touch sequence, not just the frames where two fingers are
    down.** `pinchSequence` is set by `startPinch` and cleared only once every pointer of that
    sequence has left; while it holds, a release may pan an already-zoomed photo but is never a
    tap, a swipe or a mask click (`classifyRelease`). The pinch itself still ends on the first
    finger lift, but the leftover fingers are **not re-armed as a fresh drag**: re-arming them
    measured their releases against a press point captured during the pinch — for a two-finger
    zoom closed with both fingers together that is the distance _between the two fingers_, well
    past the swipe threshold, so zooming voted on the photo and advanced (and the photo switch
    resets the rotation, which is why a rotate appeared to have never happened). A pinch release
    also leaves `gestureMoved` set, so it cannot page through `handleStageClick`, and clears
    `lastTap`, so it cannot seed a double-tap zoom.
  - **`pointercancel` is not `pointerup`.** A cancelled gesture (incoming call, edge-back, app
    switch, a second pointer stealing it) drops the gesture state, snaps any in-flight rotation to
    a resting angle, and returns the transform **without animating**. It must never reach the
    completion path: marking a photo is a server write, so routing a cancel through `onPointerUp`
    let the system hand the user a vote, a download or a menu they never asked for. One cancelled
    finger of a pinch ends the pinch exactly as a release would, and the reset only runs once
    **no** pointers remain — clearing the pinch while a partner finger was still down left that
    finger to be judged as a swipe from the original press point, on top of losing the zoom.
  - **A tap outranks a pan.** Double tap must zoom both ways, but once the photo is zoomed every
    single-finger touch is already a pan to `onPointerMove`, so judging the pan first left the
    second tap of a double-tap unreachable: zooming _in_ worked (its first tap starts un-panned)
    and zooming back _out_ silently did nothing — pinch was the only way back to a whole photo,
    and pinch is the harder gesture. `classifyRelease` therefore decides `tap` before `pan-end`,
    keyed on the release having travelled less than `TAP_SLOP`; a drag that genuinely moved is
    still a pan. Only the touch path needs this — the mouse never enters the release state
    machine at all, pairing its own clicks in the component (below).
  - **The app pairs its own double-clicks; the native `dblclick` is never trusted.** The browser
    pairs two _physical_ clicks and knows nothing about what the first one was spent on. A mask
    click is spent paging, yet the click after it still got paired — and the pair was judged
    against the layout _after_ the page change, where the same point may have moved from black
    mask onto the next photo. "Click the mask to advance, click again" therefore zoomed instead,
    most visibly in an album mixing portrait and landscape, where consecutive photos differ
    enough for the media to land under the pointer. Both modalities now keep their own pairing
    state (`lastTap` for touch, `lastMediaClick` for mouse) and zoom through the shared
    `toggleZoomAt`; **only a media click ever arms the next one**, which makes a spent click
    structurally unable to take part. A photo switch clears the armed click too, since it
    describes the photo just left. `DBL_MS = 500` matches the platform threshold a native
    `dblclick` imposed, so the gesture keeps its rhythm.
  - **The trailing `click` a touch double-tap leaves behind must not page.** A real mobile browser
    fires native `click` per tap on top of the pointer events, so the second tap's click would
    read as a mask click and page the photo the user had just zoomed; `suppressClickUntil` (600 ms)
    swallows it. Nothing listens for the native `dblclick` any more, so it needs no guard of its
    own — `handleStageClick` neither clears the window nor pairs. The e2e harness still replays
    those native events (`sendMouse`) because driving pointer events alone never exposed the bug.
  - All gesture/transform math (zoom-to-point, pinch, `Ctrl`+drag, pan clamp, overflow gate,
    rotation snap, double-tap/swipe/click-nav classification) lives in the pure module
    `web/src/base/lib/lightboxEngine.ts` and is covered by `web/tests/unit/lightboxEngine.test.ts`
    — the `<Lightbox>` component only wires events and writes the transform to the DOM. The
    multi-touch _release_ path is covered end-to-end by `web/tests/e2e/lightbox-pinch.spec.ts`,
    which drives synthetic pointer events at a phone viewport: CDP's `touchEnd` cannot state
    which finger stays down, so the case that mattered — the surviving finger dragging after
    its partner lifts — silently never happened under CDP touch.
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
    The marker is honoured on the layer node itself as well as on descendants
    (`querySelector` alone would skip it). "Focusable" excludes disabled elements, anything
    inside `[inert]`, zero-client-rect nodes and computed `visibility: hidden`. The Lightbox
    stage carries `data-autofocus` so the dialog node itself takes initial focus — without it
    the first focusable (the like button, top-left) was focused on open, popping its tooltip
    immediately and making Space toggle like instead of reaching the stage's key bindings.
    `EditorDialog` carries the marker for the same reason: its first focusable is the editor
    body's first toolbar button, whose tooltip popped the moment the dialog opened.
  - Tab wrapping is manual, in both directions, and re-wraps when focus sits outside the list.
  - On deactivation, focus returns to the previously focused element only if it was the top
    layer, is still connected, and is not inside an `[inert]` subtree.
  - Scroll lock is **stack-depth based, not per node**: the previous `body` overflow is saved on
    first activation and restored only when the stack empties, so closing an inner sheet does not
    unlock the page underneath it.
  - The action sets **no** `inert` and no `aria-hidden` — components own those themselves
    (`OverlaySidebar` sets both on its own root).
  - **Nothing asserts any of this**; `overlay.ts` has no test at all.
  - `OverlaySidebar` takes an optional `footer` snippet, pinned below the scroll region —
    always reachable without scrolling, and never under a layout preview's transparency
    (it does not overlap the scroll area, so it needs no opacity treatment). The settings
    sidebar fills it with two unobtrusive items, one per edge: the **GitHub source link**
    bottom-left — the octocat mark inlined as SVG (`GithubMark.svelte`; lucide ships no
    brand icons) at `text-muted-foreground/50`, brightening to `text-foreground` on hover —
    and the **build version** bottom-right. Neither carries a border, background or shadow.
- **Version label.** `VersionLabel.svelte` sits at the footer's right edge: the latest git
  tag at rest (`v0.1.4`), the 7-character commit hash on hover, in the timestamp's type
  (`text-xs tabular-nums text-muted-foreground/50`). It is the **same swap** as a timestamp,
  which is why both render through `SwapLabel.svelte` — the resting string slides out and the
  alternate slides in, inside one grid cell so the width never jumps.
  - Both values are **injected at build time** (`web/vite.config.ts` → `__APP_VERSION__` /
    `__COMMIT_HASH__`, declared in `app.d.ts`). The version is the latest tag **whether or not
    HEAD sits on it**, so a build off `main` shows the release it descends from rather than a
    branch name; `package.json`'s version is only the fallback for a build with no git.
  - Consequence, and the point: **a release is a tag push — there is no file to edit.** The
    deploy workflow's checkout therefore runs with `fetch-depth: 0`, because the default
    shallow, tag-less clone leaves `git describe` with nothing to report.
- **Poll rows carry one number: the count.** `VoteBlock.svelte` shows no percentage — at row
  size the percentage and the count read as clutter, and the fill bar already carries the
  proportion. The number is the transcode panel's counter exactly: `text-sm font-semibold
tabular-nums`, swapping in place inside one grid cell so the cross-fade never reflows the
  row. Its hop is `countHop` from `base/lib/motion.ts` (entry downward, exit upward), the
  generic form of the upload panel's own hop, so the two counters cannot drift apart.
  - The full reading is not lost, only moved: the number's `aria-label` still says
    "2 votes", and `web/tests/e2e/admin.spec.ts` asserts that name as well as the digit.
  - A poll nobody has answered yet shows no number at all — an empty poll is already legible
    from the fill bar, and "0" on every row is noise.
- **Editing a poll keeps its votes unless the question changed.** A vote is stored as an option
  _index_, and the editor keeps options in order, so a same-length edit — fixing an option's
  wording — leaves every index addressing the same choice and the votes stand. Changing the
  choice mode or the number of options asks a different question, so the votes clear. The
  `PollEditorDialog` footer states this in one line (`admin.poll.editVotesHint`), and the client's
  optimistic fold (`ops.applyPollUpdate`) applies the same two conditions the server does, so an
  edit cannot show a count the next snapshot contradicts. ⚠️ An API caller that **reorders** a
  same-length option list gets votes silently re-pointed at different labels — the editor has no
  reorder gesture, which is what makes the length test sufficient.
- **Markdown follows `github-markdown-css` (light mode) for its non-interactive elements.** Two
  things were wrong at once, and the second was the more visible one.
  - **Colour.** `@tailwindcss/typography` styles `.prose` entirely through `--tw-prose-*` variables
    and ships a **light-surface** palette — body defaults to `oklch(37.3% .034 259.733)`, a
    near-black that renders as a dark slab on this background. GitHub's own values are defined for
    a white canvas (`#1f2328` on `#ffffff`), so they are **not pasted**; each maps onto the nearest
    site token, which keeps GitHub's tonal _relationships_ (body brightest, one muted tier for
    quotes / lead / markers / captions, borders quietest) without importing a second palette.
    Measured on the rendered page: body **15.62:1**, links **10.65:1**.
  - **Structure.** The plugin ships headings at 800/700/600/600/**400/400**, so **h5 and h6 rendered
    at body weight — the faintest thing in a document**, and the likeliest reason the text "read
    thin". GitHub runs every level at one weight. `app.css` now pins: all six headings at
    `font-weight: 600`; GitHub's size ladder 2 / 1.5 / 1.25 / 1 / .875 / .875 em; a hairline under
    h1 and h2 with `padding-bottom: .3em`; the quote as `padding: 0 1em` + a `0.25em` left bar,
    weight 400, upright, **and no quote glyph**; lists indented `2em`; `hr` as a `0.25em` band
    with a 1px rule; inline code as a chip (`.2em .4em`, 6px radius, 85% size, `--color-border` at
    45% alpha); tables as described below.
  - **A table is body text in a grid, and a wide one scrolls.** The plugin's `prose-sm` variant
    sets `.857143em` on a table — **12px against the 14px body** — so every cell read smaller than
    the prose around it. `font-size: 100%` restores parity, which is what GitHub does by setting
    no table size at all. The rest is GitHub's: `border-collapse: collapse` with
    `border-spacing: 0`, cells at `6px 13px` with a 1px `--color-border` grid, `th` at weight 600,
    a `tr` top rule, zebra rows tinted with
    `color-mix(in srgb, var(--color-foreground) 5%, transparent)` (proportional to the surface,
    rather than a fourth fixed grey), and `font-variant-numeric: tabular-nums`.
    - `display: block` + `width: max-content` + `max-width: 100%` + `overflow: auto` is how a wide
      table scrolls instead of wrapping every cell, and why a narrow table hugs its content
      instead of stretching to the column — both GitHub's behaviour. Measured: a 10-column table
      in a 360px column renders 360px wide with `scrollWidth > clientWidth`; a 2-column table
      renders 122px.
    - Margins are `1.25em`, the plugin's own paragraph margin, so a table sits in the same rhythm
      as the text around it. The plugin asks for `2em`, which is wider than its paragraphs and
      left the table floating.
  - **No decorative text is injected into a rendered line.** The plugin adds glyphs through
    `::before` / `::after` in two places, and both are **text**, so a reader who copies the line
    carries them along:
    - `blockquote p:first-of-type::before { content: open-quote }` and its `::after` twin. They
      render flush against the text, so a quoted line reads as one run rather than a quote, and
      the bar already marks the block.
    - `code::before, code::after { content: "\`" }` — a literal backtick around **every inline
code run**, which is why `` `Ctrl` `` rendered with visible backticks in a heading or a list
item. Fenced code was unaffected because the plugin already resets `pre code`to`none`,
      which is what made it look like an inline-only quirk.

    Both are overridden to `content: none`, as GitHub does by emitting no glyphs. The chip marks
    the code and the bar marks the quote; neither needs a character. This is the complete set —
    the only other `content:` in `.prose` is the plugin's own `none` for `pre code`.
    `designTokens.test.ts` asserts both overrides **and** that the layer injects no `content:`
    string of its own.

  - **Interactive elements are excluded, deliberately.** Links keep `--color-primary`, and
    `MarkdownView`'s own file / media affordances are untouched — this palette is GitHub's answer
    for reading, not for the controls layered over it.
  - ⚠️ **The block must stay in `@layer utilities`, not `base`.** `.prose-invert` declares the
    same variables and the plugin emits it into that layer; a later layer beats an earlier one
    regardless of source order, so a binding in `base` is silently dropped and the page falls back
    to the light-surface default. This is invisible in a diff — the rule is present and correct.
    The `:where()` structural overrides depend on the same layer for the same reason, and win by
    order within it (verified in a browser, not reasoned about).
  - ⚠️ **Do not pass a colour class to `MarkdownView`.** `class="text-muted-foreground"` sets `color`
    on the container, which beats `var(--tw-prose-body)` and drags every paragraph to 5.23:1.
    Tone a prose surface through the variables, not from the call site. `class` remains for
    layout only (width, margin).
  - `designTokens.test.ts` asserts the layer, that every value names a declared token, the heading
    ladder and shared weight, the quote bar, the code chip, and that no structural rule hardcodes
    a hex. Each guard was verified against the regression it exists for.
- **Upload overlay.** `UploadPanel.svelte` is the only upload overlay.
  - **The facade address is configuration, never a constant.** `/sync` names the host in
    `mediaHostUrl`; the Worker reads `MEDIA_HOST_URL` and the page forwards it to the
    SharedWorker. There is no default host in either runtime: an unset value produces an
    empty `mediaHostUrl` and the SW fails the job with `media_host_unset`, because guessing a
    host would send someone's photo somewhere nobody chose. The SSRF guard's loopback
    exception is unlocked only when `MEDIA_HOST_URL` itself names a loopback origin — what
    `.dev.vars` does for `npm run dev` — never by an absent value, which is a misconfigured
    deployment. **The local stand-in's port is written once, in `MEDIA_HOST_URL`** in
    `.dev.vars`: the Worker loads that file, and `dev:media`, `predev`'s port sweep and the
    e2e webServer read the same value through `scripts/dev-config.mjs`. `.dev.vars` is
    gitignored and `.dev.vars.example` is tracked (wrangler's own convention), so a fresh
    clone can copy it once and the scripts fall back to it before that. `LOCAL_MEDIA_HOST_URL`
    as a hardcoded `src/` constant was removed on 2026-10-19 for exactly this reason.
  - Panel rows exist only for phases in `PANEL_STAGES = {queued, lease-wait, transcoding,
hashing}`. `uploading` and `failed` appear on the **card**, not as rows.
  - **The local preview is the OPFS artifact, and holds until the hosted copy is paintable.**
    The card never previews the picked file: a card only exists after stage 1, so the artifact
    is already on disk, and it is the bytes the album will hold. `meta` is the signal — it is
    set exactly when the artifact lands — so `ensureArtifactPreview` reads `{jobId}.{ext}` back
    and nothing else seeds `previewUrls`. Two reasons this is not just tidier: a picked Blob URL
    dies with the page, so a replayed job had no preview at all after a reload; and a **GIF**
    previews into a `<video>` (its `type` is 1), which cannot decode a GIF, so every GIF upload
    sat on its skeleton for the whole transfer. When `done` arrives the card keeps that local
    preview until the page has fetched the hosted URL with the element that will paint it
    (`ensureHostedReady`: an `Image` for images, a `video` stopped at its first frame), then
    swaps. `pendingMediaUrl` is the one rule: `pending` → local, `ready`/`failed` → hosted.
    ⚠️ Swapping `src` first is what produced the "long loading animation" report: it replaced an
    already-painted image with bytes the document had not fetched, and the skeleton is derived
    from `loadedUrl !== photo.url`. The one cost of reading the artifact is that the first frame
    after the card appears can still be a skeleton, because the read is asynchronous; it starts
    at the same moment as the upload and reads local disk, so it is a few milliseconds, and the
    alternative (a wrong preview, or none at all) is worse.
  - **A photo whose upload finished but whose row is not confirmed still has a card after a
    reload, projected from the op log.** This is the one place the op log is a _render_ source
    rather than only a write queue, and it is the difference between a timed-out 200-photo batch
    leaving 200 invisible photos and leaving 200 cards the user can see — and delete. After
    `done` there is no resume record (`sw.ts` deletes it), no live job (`replayJobs` skips
    `done`), and no artifact to borrow: `reclaimTerminalJobs` prunes terminal artifacts down to
    30 every 15 s, so a 200-photo batch could not be covered by them anyway. What survives is the
    `upload` op, and it is complete — `payload.url` is the hosted URL, plus width/height/size/
    type and the upload instant the SharedWorker stamped. The card is `queuedUploadFromOp` →
    `queuedUploadCards` → `pendingPhoto`, read once at page open and again when a sync attempt
    ends (`SyncEngine.queuedOps`), and it is **never a sync trigger of its own** (ADR 0008).
    ⚠️ Four rules hold it together: it carries **no overlay** — nothing measured it, and a
    curtain parked at `CURTAIN_MAX_OPEN` would draw a permanent 10% band that reads as progress
    which does not exist; it is drawn through `pendingPhotos` behind the same landed-sha guard as
    a `done` card, so a snapshot carrying the sha replaces it without a double frame; it is
    deduped against the live tasks' shas, so a job still on screen never gets a second card; and
    deleting it uses the ordinary pending-photo path (withdraw, then tombstone) plus one
    session-scoped suppression — an `upload` op carries no `targetSha`, so `removeOpsBySha`
    cannot withdraw it and a re-read would put the card back until a sync clears it. A delete in
    another tab becomes visible here only at the next read.
  - **No prewarm in the SharedWorker.** It used to fetch the returned URL (no-cors, 2 s cap)
    before reporting `done`, on the theory that the card would then swap over a warm cache.
    A worker's fetch does not populate the renderer's cache, so it bought a second download of
    every artifact plus up to two seconds of delay before `done`. Measured with a 900 ms delay
    on the hosted response: without the page-side gate the card's **first** paint was the
    unloaded hosted image (a skeleton for the whole 900 ms); with it, the local preview stayed
    up for ~52 frames and the swap landed already complete (0 blank frames, 0 hosted-before-painted).
  - **The card's curtain tops out at `CURTAIN_MAX_OPEN = 0.9`**, so an upload at 100% still
    keeps a 10% veil across the top edge; only the `done` phase removes it. That veil is why a
    stalled tail reads as "stuck at the last bit" rather than as a finished upload.
  - **One POST is governed by two deadlines, because its two halves fail differently.** While
    the body is moving, `UPLOAD_IDLE_TIMEOUT_MS = 45s` measures _silence_ and restarts on every
    progress event (never a wall-clock cap). The body's end — `xhr.upload.onload`, or a final
    progress event at 100% — switches the attempt to `UPLOAD_RESPONSE_TIMEOUT_MS = 120s`, which
    covers the facade relaying the artifact upstream and the upstream storing it. Measuring that
    window with the silence budget killed large artifacts exactly at their tail. A cancelled job
    is `aborted`; either deadline is `timeout`, and the detail names which one (`no progress
before deadline` / `no response before deadline`).
  - **The upload leg has its own concurrency ceiling**, `uploadPoolSize()` = 3, or 2 below a
    2 Mbps reported downlink. It is deliberately not the image pool: that one is sized for
    cores (up to 6) and bounds _transcoding_, and letting it bound the network leg opened one
    concurrent 100 MB POST per core against a single upstream. Every upload leg passes through
    the one gate in `sw.ts` — image, video, editor and resumed alike — and a finishing job hands
    its slot straight to the next waiter. A job waiting on the gate reports no fraction, so its
    card stays fully veiled, exactly like the transcode phase.
  - `indeterminateRow` is true when the phase is `queued` or `lease-wait`, **or** when the
    fraction is `null`. An indeterminate row carries no `aria-valuenow` and sweeps.
  - `batchProgress` returns the mean of the measured rows **only if every row measures itself**;
    otherwise `null`, which renders as a sweep. A total that quietly omitted an unmeasured stage
    would state a number the work does not support — this is ADR 0002 in code, not a convention.
  - The header shows the **remaining count** (`total − done`) only when `total > 0`. The
    `{done}/{total}` pair was tried and read as clutter at header size (user call).
  - **The drawer follows the panel's presentation, not the input device.** The panel is a
    full-width bottom sheet below `md` and an 18rem corner card above it; the component measures
    that form itself (`rect.left < LEFT_EDGE_MAX`) instead of assuming a breakpoint. A
    full-width panel is always a tap-toggled drawer with a chevron at the right edge (up =
    closed, down = open), even in a narrow desktop window whose pointer can still hover — that
    mismatch is how the chevron went missing from a mobile-looking panel. The corner card keeps
    hover-to-expand plus click-to-pin. The header is one `<button>` in both modes, and there is
    no drag gesture any more; the drawer height moves between the header's height and the capped
    content height, so a row leaving while it is open shrinks it without stranding empty space.
    The header height is **measured** (`shell − body` from the panel's own ResizeObserver, the
    same difference `restHeight` reports), never a constant: `py-3.5` plus the `text-sm` counter
    makes it 48px, while the `text-xs` label alone makes it 44px, and a hardcoded value was
    wrong whenever the counter was hidden. The open height and the scroll container's `max-height` both come from one measured
    `visualViewport.height` (42%): a second `svh` cap in CSS disagreed with the JS ceiling
    whenever a mobile URL bar moved. Collapsed, the batch total rides the bottom edge.
  - **The waterfall reserves the panel's measured footprint at its own bottom, differently per
    scroll axis.** `UploadPanel` reports two heights through `onGeometry`: `height` (live shell,
    follows the drawer) and `restHeight` (shell minus the expanding body, constant while the
    drawer animates). When the panel is flush with the viewport's left edge (the mobile,
    full-width presentation) `App` passes both to `WaterfallLayout`.
    - **Vertical (`dir='v'`)** renders a spacer after the canvas of `height + bottomSlack`, so
      the last row scrolls clear of the panel and keeps breathing room. Both strategies
      (`sequential`, `shortest`) use that one spacer; `shortest` simply leaves its shallower
      columns ending higher. The spacer follows the live drawer, so an open drawer can also be
      scrolled past.
    - **Horizontal (`dir='h'`)** cannot append scroll length: the canvas's height _is_ the
      viewport cross size and touch pans only horizontally (`touch-pan-x`). It subtracts
      **only `restHeight`** from the layout's cross size, so every column ends exactly at the
      resting panel's top edge. `restHeight` rather than the live `height` is deliberate — the
      live value would reflow every column on each frame of the drawer animation. There is no
      `bottomSlack` in this axis (user call): extra breathing room would push the grid too far
      up for a horizontal scroll. An _open_ drawer simply overlays the bottom of a horizontal
      grid; that occlusion is
      deliberately not handled, while a vertical grid can be scrolled past it.
    - `bottomSlack` is two zoomed layout gaps with a 16px floor, applied **only to the
      vertical spacer**, so the breathing room follows the user's gap slider instead of a
      second magic number. Both heights are measured from the panel's own shell — never a
      breakpoint or a guessed header height; on the desktop panel (bottom-right, 18rem wide)
      both are zero because it does not span the gallery's bottom edge.
  - **The announcement editor takes any file.** Its input carries no `accept`, and both
    `uploadEditorFile` and the SW's `addJob` skip the album's `routeByMime` gate for the editor
    leg. The picked file is uploaded as-is, so its extension survives into the returned URL. How
    it lands in Markdown is decided by the extension — and the same predicate decides how it
    renders, so what is inserted is what appears:
    - a real image extension (webp/jpg/png/gif/avif/heic/svg…) → `![](url)`, rendered as
      `<img>`.
    - a video extension → `![](url)`, rendered as `<video>` (muted, looping, click to
      unmute); an audio extension → `![](url)`, rendered as `<audio controls>`.
    - **anything else — a `.pdf`, a `.zip`, no extension at all — becomes `[name](url)`**, a
      plain link the reader clicks to open or download. `isEmbeddableArtifact` is the one
      predicate (image ∪ video ∪ audio extensions) and is shared by `insertMediaAt` and
      `markdownImageRule`, so what the editor inserts is what the page renders.
    - **The renderer emits the final element; nothing is upgraded after parsing.** The trusted
      renderer (`mdFull`) replaces markdown-it's `image` rule with `markdownImageRule`
      (`core/markdown.ts`), so `![alt](url)` is born as `<img>`, `<video>`, `<audio>` or
      `<a class="markdown-file" download>` according to the same extension predicate. The browser
      therefore never sees a placeholder `<img>` and never downloads a `.pdf` in full to render a
      download button; a video is one request, not two.
      - `MarkdownView` assigns the sanitized result directly. The old `<template>` stage existed
        only to prevent that placeholder fetch; with the final element already in the string it
        has no job left and is gone.
      - ⚠️ **Do not reintroduce a post-parse element swap.** It looks equivalent, but every
        `![]()` would become an `<img src>` in the live document first, and replacing the node
        does not cancel the request it started.
      - The shimmer/aspect-ratio holder is part of the renderer's image/video markup
        (`<span class="md-media skeleton">`); one delegated `load` / `loadedmetadata` listener on
        the container removes the shimmer and writes the real ratio. It still requires a real
        intrinsic size (`naturalWidth > 0`), so a cached image settles instead of leaving the
        holder on its 16:10 placeholder.
      - `mdSafe` keeps images disabled for public content: the rule is installed on `mdFull`
        only.
    - Video is muted for autoplay (`autoplay loop muted playsinline`) — the only autoplay browsers
      allow — and one delegated click listener on the container toggles the sound. Audio is a
      full-width `<audio controls>` with no aspect-ratio holder: a player is a bar, not a picture.
    - The toolbar button is **File**, not Image.
    - **No alt text.** The file name used to be the alt, and the browser paints alt as
      broken-image text while the image decodes — it read as an ugly caption over the
      placeholder. `alt` is now empty; the name is still worth keeping as a link label, which is
      what `insertLinkAt` falls back to when a file has no embedded name.
      The album's own `image/*,video/*` gate and its transcode legs are untouched.
  - **The editor previews the picked file locally, at its measured size.** The editor leg
    uploads the picked file as-is, so the bytes in hand are the bytes the hosted URL will serve:
    `AnnouncementEditorDialog` creates an object URL and calls `probeSourceSize` the moment a
    file is picked, and the preview pane renders that image inside a box reserved at the **probed
    ratio**. It is cleared the moment the hosted URL lands, so the local stand-in and the hosted
    image are never both on screen. This is the card curtain's mechanism applied to the editor,
    and it exists because of what it removes — ⚠️ §4.12.
    - `.md-media`'s hardcoded `aspect-ratio: 16 / 10` is the **fallback**, not the normal path.
      A picked image is measured before it is shown, so the guess should never be seen; it
      survives only for media whose dimensions arrive late or never.
    - `isImageFile` gates the preview on MIME **or** file name, because a Windows pick with an
      empty MIME must still preview.
  - **A photo's `createdAt` is the moment its upload URL arrived, not the moment /sync ran.**
    `serverTime` is read once per request, so a batch of uploads would otherwise share one
    timestamp and "latest" could not order them. The SharedWorker stamps `Date.now()` when the
    facade returns the URL, carries it in the job-status message, and the page writes it into the
    upload op. The server keeps that value but **clamps it to its own clock**
    (`Math.min(createdAt, serverTime)`) so a skewed or forged client cannot pin a photo into the
    future; `uploader` stays server-authoritative. An upload payload with no `createdAt` is
    dropped, like any other payload missing a required field. `sortPhotos('latest')` breaks
    equal timestamps by id, so a same-millisecond pair still keeps upload order.
  - **A returning visitor renders the persisted snapshot before the network answers.** The last
    `/sync` response is stored whole in `metaCache` (under the reserved key `snapshot`, which a
    64-hex album hash can never collide with) and `engine.init` hands it to the store before the
    first request; the sync then replaces it with the authoritative one. **Every surface that
    reads the store must wire `onCachedSnapshot`** — `App.svelte` and `Admin.svelte` both do.
    Wiring only the gallery left the admin tabs blank for a round trip, and blank forever with no
    server; that gap is why this sentence names both call sites. The same page-open pass also
    reads the **op log** (`refreshQueuedUploads` in the upload store): a photo the snapshot cannot
    know about — its row was never confirmed — is exactly the one a returning visitor would
    otherwise lose, and the two reads together are what make "render before the network answers"
    mean the whole screen.
  - **Deleting a pending photo withdraws its ops; it does not delete after the fact.** A sha
    with no server row is a pending upload, so `deletePhotos` routes it to
    `withdrawPendingUpload`: the card's cancel sink (registered by the upload store through
    `setPendingUploadCancelSink`, the same layering bridge as the media-host sink) aborts an
    in-flight transfer before it can write its upload op, `engine.removeOpsBySha` withdraws
    every queued op carrying that sha (the marks — a like on a photo that never lands is a server
    no-op but a lie in the log; an `upload` op carries no `targetSha`, so it is the tombstone that
    cancels it, not the withdrawal), and only then is a `delete` op filed.
    That op is the **tombstone**, and it must come after the withdrawal — `removeOpsBySha`
    matches by sha and would otherwise take the tombstone with it. The tombstone covers the one
    race this cannot close locally: an upload op already claimed by an in-flight sync request
    cannot be un-sent, so if it lands the next sync deletes the row it created, and if it fails
    the op is simply gone. The other half of the same race is closed in `onUploadOp`, which
    writes nothing when no tracked task still owns the sha: a `done` notification arriving just
    after a delete would otherwise append its upload op behind the tombstone, and the photo
    would land. Before this, deleting a pending photo touched neither the card nor the oplog:
    the card stayed as a ghost until a reload (the optimistic card is the upload store's, not
    the photo store's), and a delete filed while the upload was still in flight appended as
    `[delete, upload]` — the server no-ops the delete on an unknown sha and then creates the
    row, so the "deleted" photo landed for real. The delete glue itself is untested
    (`createUploadStore` needs a component context); `removeOpsBySha` is (oplog + engine
    suites), and the deferral below is (`pendingPhotoOps.test.ts`).
  - **A photo op must follow the upload op that creates its row.** A mark whose sha the snapshot
    does not carry is not written to the log at all: `/sync` applies a batch in array order, so
    it would be a no-op on an unknown sha (its `UPDATE … WHERE sha256 = ?` matches no row) and then cleared as
    confirmed — the mark silently lost. The mark itself is the state (`pendingMarks`, persisted),
    and `photoOpQueued` states it as ops — awaited by the upload store when the upload op lands,
    and also called by `applySync` for a row the snapshot has just delivered. That is what makes
    it reload-proof: a queue of ops would not have been. Before this the mark was submitted
    immediately, the log read `[like, upload]`, and the like was lost and its op cleared. The
    condition is the whole subtlety: the first version of this mechanism tested only "an upload
    op is queued" — a flag set when one is written — so a mark on any photo loaded from a
    snapshot was dropped forever, which is why it was deleted in `eb1dd41`, not redundancy. Ops
    that write a last-value dimension are additionally superseded **in place** by
    `engine.addOp` (ADR 0016), and like and dislike share one dimension because **the server
    clears the opposite column in the statement that writes either** — the exclusion is a server
    guarantee now, not a client convention, so a switch costs one op.
  - **That ordering guard is for marks only; a delete is the opposite case.** Deleting a sha the
    server has never heard of is a harmless no-op (`DELETE … WHERE sha256 = ?` matches no row), and the pending
    photo's tombstone depends on exactly that. So `deletePhotos` submits its op straight to
    `submit`, never through the guard — the optimistic removal has **already** taken the row out
    of `photos` by then, and routing a delete through the "does this row still exist?" check
    dropped every synced-photo deletion silently: the card vanished, nothing was queued, and the
    photo came back with the next snapshot. A guard that reads like a general "unknown sha" rule
    and is reached only by mark writers is the whole hazard.
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
  - **A card can be translated into the other registered locale.** Each announcement and poll
    row carries a `Languages` control (`routes/admin/TranslateButton.svelte`, one component for
    both lists — the markup used to be duplicated) whose accessible name names the target
    language and whose glyph becomes a spinner while that card's request is in flight. One
    request at a time: the busy flag disables every card's button. Success switches the page's
    language and content bucket to the target locale and opens the existing **create** editor
    seeded with the draft — nothing is written until the admin saves, and the save goes through
    the normal create endpoint. `POST /admin/translate` is root-only and stateless (the body
    carries the content, never a row id): a deployment without the `AI` binding answers
    `503 translation_unavailable`, a model failure or empty output `502 translation_failed`, a
    body over `MAX_TEXT_LENGTH` `413 too_large`, and a malformed body `400`. Local dev may set
    `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` in `.dev.vars` to post to the REST endpoint
    instead, because the local binding's remote edge path is unreachable on some networks;
    production has neither variable, so the binding is the only transport there. Fenced code, blank
    lines and whole-line `::poll:` references pass through untranslated (ADR 0021). Its limits
    are the shared `MAX_TEXT_LENGTH` / `MAX_POLL_OPTION_CHARS` in `shared/types.ts` — the same
    constants the sync validator and the poll editor use — and the request parser lives beside
    the model adapter in `worker/translate.ts`, so a rule is written once.

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

- **The glitch's JS half cannot be unified, by construction.** The scramble-on-mount, the random
  idle burst and the hover trigger all need JavaScript, and the Worker page ships no glitch
  script (`errors.test.ts` asserts the page's only `<script>` is the font race). The Worker's
  glyph therefore runs the ambient slice/jitter and can never burst. Same visual language, less
  capability — that is the intended end state, not an oversight.
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

### 4.10 A tooltip popped on focus, and focus lands by itself

**Resolved 2026-10-11.** Converting every native `title` to the custom Tooltip (`5fa4d3c`)
made a latent trap visible in thirteen files at once: `Tooltip` showed on `focusin` with
`show(true)` — immediately, with no hover, and past the touch guard (`hover: none`) that the
pointer path obeys. Focus lands on controls without the user asking: the browser focuses a
button on mousedown, an overlay's `focusFirst()` focuses its `[data-autofocus]` node, and
deactivating a layer restores focus to the trigger.

The symptoms, all reproduced with the pointer parked across the screen: opening the settings
sheet popped "Close" (its close button carries `data-autofocus`), closing it popped
"Settings" (focus restored to the trigger), a plain click popped a bubble instantly instead
of after the 350ms hover delay, and hovering one control while focus sat on another left
**two** bubbles up at once, each instance blind to the other.

A native `title` never appears on focus, so none of this existed before the conversion — the
trap was invisible, not absent. The Lightbox had already been bitten by it once (⚠️ §3: its
`data-autofocus` moved off the like button onto the stage, because focusing the button
"popped its tooltip immediately"); that was a workaround at one call site, and this is the
rule: **the focus path requires `:focus-visible`** — false for mousedown focus, overlay
initial focus and focus restore, true for Tab — plus the same touch guard as hover, and a
module-level slot so only one tooltip is on screen at a time. `web/tests/e2e/ui.spec.ts`
asserts the whole sequence.

Deliberately left alone: closing a sheet with **Escape** is a keyboard interaction, so
Chromium treats the restored focus as `:focus-visible` and the trigger does show its bubble.
That is the modality that earns tooltips, and the bubble tells the user where focus went.

### 4.11 The progress sheet stopped following the finger

**Resolved 2026-10-11; the gesture itself was retired on 2026-10-25.** The touch sheet is now a
tap-toggled drawer (see the upload-overlay entry), so there is no live gesture left for the
frozen-ceiling rule below to constrain. The entry is kept because the underlying trap — a
ceiling recomputed from a shrinking row set while a pointer moves — applies to any future
resize surface.

The upload panel's touch drag clamped its height to `naturalH()`, which
was recomputed from the live row count on every move. `panelRows` shrinks as jobs finish, so a
row completing mid-gesture pulled the ceiling down and the sheet moved **opposite** to the finger:
a measured drag grew the shell 24→48→72→…→149px, then dropped to 120px and 64px while the finger
kept travelling up. The header was also declared 44px when it renders 48px (px-3.5 + text-sm), so
every drag started with a 5px jump.

The fix freezes the ceiling at pointerdown and moves the resting clamp into an effect that is
skipped while `dragging` — a finishing row still collapses a _resting_ sheet, but never one under
a finger. Re-measured with a stable row set: finger +288px, shell +288px, monotonic. The gesture
also moved onto `base/lib/pointer.ts#startPointerResize`, which the other resize surfaces already
use; the hand-rolled `pointermove`/`up`/`cancel` handlers were the second copy MEMORY.md warns
against.

### 4.12 Two copies of the same thing are only duplicates while both work

**Resolved 2026-10-12 (ADR 0017).** The web fonts raced two sources once (ADR 0006) and the race
was removed twice over — first because the mirror's TLS handshake failed, then because both
endpoints are Google's own and "racing them adds a request and a script to pick between two
copies of the same thing" (ADR 0011). The premise of that second rejection was never measured,
and the measurement sitting in ADR 0011 contradicts it: fetching 14 of the family's `woff2`
subsets took **45 s and zero failures** from `fonts.gstatic.cn` against **102 s and two
failures** from `fonts.gstatic.com`. A source that drops two of fourteen subset fetches is a
fallback, not a duplicate.

Both endpoints now load concurrently and the first to load **cancels every other link in the same
task**, so a loser never declares the families and never triggers its own font downloads. A
source that _fails_ removes only itself and leaves the rest racing; a link already detached
ignores its own late events, so a removed link can never settle the race afterwards.

The script sits **before** the stylesheet links, and that order is load-bearing: a pending
stylesheet blocks the scripts after it, so a race script written last cannot start until the
slowest source has already downloaded — measured at 1516 ms against a deliberately-slow 1500 ms
endpoint. Because the links arrive after it, the script claims each through a
`MutationObserver`. What "cancelled" buys was measured too: with a 0 ms endpoint against a
1500 ms one the loser's link was detached at **221 ms**, though its HTTP response still reached
the server and was discarded. The saved work is the _application_ — no `@font-face` from a
loser, no `woff2` requested — not the duplicate CSS transfer.

The rule this leaves behind: **"the same thing served twice" is a redundancy argument only after
both copies have been observed failing.** Endpoint identity is not availability, and a shared
vendor is not a shared failure mode. The mirror case stays retired for the reason that was
measured — a handshake it cannot complete — and a source earns its place in the race by
completing an end-to-end check, not by existing.

The error page's only `<script>` is this race, and it runs by SHA-256 hash rather than
`script-src 'unsafe-inline'`, so the page that has no other JavaScript keeps that hole shut
(ADR 0006 needed `'unsafe-inline'`; dropping it was one of that ADR's stated wins).

### 4.13 A rhythm margin only looks wrong when nothing absorbs it

**Resolved 2026-10-12.** An announcement whose Markdown is a single image rendered a 24px empty
line above the picture. `@tailwindcss/typography` gives every `img` inside `.prose` a
`margin: 1.71429em 0`, and that number is not arbitrary — it equals `prose-sm`'s
`line-height: 1.71429` exactly, so an image _between_ two paragraphs reads as precisely one blank
line. That is the intent: the margin is a paragraph rhythm, and it is designed to sit against
text.

The plugin's own `.prose > :first-child { margin-top: 0 }` cannot absorb it, because a lone image
is wrapped in a `<p>` and **the margin lives inside that `<p>`, not on it** — the reset only zeroes
the `<p>`'s own margin. So a block with a text neighbour looks right and a block of only images
shows the rhythm as raw whitespace. The same margin is _also_ invisible in a normal
multi-paragraph document, which is why nothing about it reads as a defect in the plugin.

Fixed by collapsing the margin only where the image opens or closes the block, matching GitHub,
which gives a lone image no margin at all and lets the surrounding blocks set the spacing.

**Two lessons, both about measuring the thing the user sees.** An `img` margin collapses out of its
`<p>`, so a probe that measures from the top of `.prose` to the top of the image reads a different
number than the rendered gap — measure from the element _above_ the prose block. And the first
version of the fix asserted "multi-image announcements are untouched", which the measurement
refuted (two adjacent images went 24 → 16, because each is both first and last child); the comment
was corrected to the measured numbers rather than the intent.

### 4.14 The editor upload rendered in three phases, and all three were one bug

**Resolved 2026-10-12.** Uploading a file in the announcement editor visibly went through three
states: a fixed-size skeleton wearing the file name, then a resize as the picture appeared, then
the correct size. Reported as three symptoms; it was one.

The editor inserted the markdown **after** the upload resolved, so for the whole upload there was
nothing in the preview to measure, and `.md-media` falls back to a hardcoded `aspect-ratio: 16 / 10`
until the browser reports `naturalWidth/Height` on load. The three phases were therefore: the
16:10 guess (phase 1), the snap to the real ratio when the image decoded (phase 2), and the true
box (phase 3). The "ugly filename" was the `alt` text — browsers paint `alt` as broken-image text
while the image is still decoding, so the file name read as a caption over the placeholder.

The fix uses what the waterfall has used all along: `probeSourceSize` already reads the real
dimensions from the picked file (`createImageBitmap`, or `videoWidth/Height` for video). The editor
never called it. It now creates an object URL and probes at pick time, so the preview shows the
real bytes in a box reserved at the **probed** ratio — and because the editor leg uploads the file
as-is, those are the same bytes the hosted URL will serve, which is why a local preview is honest
here in a way it would not be on the album's transcoding leg.

Measured over a full upload, sampling every 0.9s: a 600×300 landscape held **648×324** and a
300×900 portrait held **648×1944** for every sample, start to finish, with `alt` empty. The
worst-case portrait is the one that matters — under the old path it snapped from 16:10 to 1:3.

The general lesson, and the reason this is in the register: **a hardcoded placeholder ratio is a
guess that hides a measurement you could have taken.** The same `isImageFile` gate accepts either
a MIME type or a file name, because Windows picks often arrive with an empty MIME and refusing to
preview those would be worse than an imprecise type.

### 4.15 A Worker-owned route can hide behind the asset layer

**Resolved 2026-10-18.** A copied `/l/<id36>` link opened in a browser showed the app's own 404
page. The Worker was fine: the same URL fetched with `curl` returned the image. A second episode,
found the next day, broke every API write in production with a bare `405` while all GETs kept
working. Same layer, same cause, opposite symptom.

Cloudflare checks static assets before the Worker, and a request the asset layer does not serve
never reaches it. **It declines two different ways, and the second one only bites on writes:**

| request                                        | asset layer's answer                                      | reaches the Worker? |
| ---------------------------------------------- | --------------------------------------------------------- | ------------------- |
| browser **navigation** to a path with no asset | `index.html` via `not_found_handling`, Worker not invoked | no                  |
| **any non-GET/HEAD** to a path with no asset   | `405`, `Content-Length: 0`                                | no                  |
| path listed in `run_worker_first`              | —                                                         | yes                 |

The first episode only registered the navigations, and the reasoning written down at the time —
"`POST /sync` is safe only because the asset layer never handles POST" — was **flatly wrong**.
Measured on production, every write path was `405` with an empty body while the GETs that _were_
listed worked fine:

| path                                   | before fix              | after fix  |
| -------------------------------------- | ----------------------- | ---------- |
| `POST /sync`                           | `405`, 0 B              | `200`      |
| `POST /admin/announcements`            | `405`, 0 B              | `403` JSON |
| `POST /admin/polls`, `/admin/feedback` | `405`, 0 B              | `403` JSON |
| `POST /admin/migrate`                  | `403` JSON (was listed) | unchanged  |
| `GET /l/19`                            | `200 image/webp`        | unchanged  |

**The rule is "every path the Worker serves", not "every path a person navigates to".** A method a
browser never sends is still a method the site sends — `fetch` and `XMLHttpRequest` issue POSTs that
never appear in an address bar.

**Three wrong turns worth recording, because each looked conclusive:**

- A `curl` without the `Sec-Fetch-*` headers **is not a browser**. It skipped the exact code path
  under test, and returned a convincing `200 image/webp`.
- `Accept: text/html` alone does not reproduce the navigation case either; only the navigation
  headers do. And a 405 has no body at all, so there is nothing to read.
- `wrangler dev` does not reproduce either one — its local asset emulation routes every request to
  the Worker. A local green result says nothing about the production routing layer.

`run_worker_first` in `wrangler.toml` lists every Worker-owned path; each collection base appears
both bare and with `/*`, because Cloudflare does not document whether `*` crosses `/`, and
`/admin/polls/12` is a segment deeper than `/admin/polls`. `/` and `/admin` stay with the asset
layer — that is what serves the SPA shell. **This is now gated**: `src/worker/assets-routing.test.ts`
asserts the list against `createApp()`'s own route table, so adding a route without listing it fails
`npm test`. The two-`curl` comparison above is still the only check that the _production_ layer
agrees with the list.

---

## 5. Executable gates

The parts of this contract that are asserted by `npm test`:

| Invariant                                                                            | Enforced by                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------- |
| §1.1 table equals the `@theme` block in `web/src/app.css`, both directions           | `web/tests/unit/designTokens.test.ts`       |
| `motion.ts` motion fallbacks equal the `@theme` motion tokens                        | `web/tests/unit/designTokens.test.ts`       |
| `schema.sql` equals `schema-ddl.ts` byte for byte                                    | `src/worker/schema-alignment.test.ts`       |
| Layer direction: no import points above its own layer (AGENTS.md red line 5)         | `web/tests/unit/layering.test.ts`           |
| Every Worker route is in `run_worker_first`, and the SPA shell is not (§4.15)        | `src/worker/assets-routing.test.ts`         |
| No `transition` in `web/src` carries a literal duration or easing curve              | `web/tests/unit/designTokens.test.ts`       |
| `GLITCH_PALETTE` equals the matching `@theme` colours                                | `web/tests/unit/designTokens.test.ts`       |
| The reflow flip window outlasts the reflow duration it brackets                      | `web/tests/unit/motion.test.ts`             |
| Lightbox gesture geometry: clamp, anchor, pinch, tap/swipe/click                     | `web/tests/unit/lightboxEngine.test.ts`     |
| The upload's silence budget ends where the response budget begins                    | `web/tests/unit/uploadClient.test.ts`       |
| The upload leg's ceiling holds independently of the image pool                       | `web/tests/unit/uploadPool.test.ts`         |
| `uploadPoolSize` stays under the image pool at its widest                            | `web/tests/unit/pipeline.test.ts`           |
| Which op dimensions collapse, and which never do (ADR 0016)                          | `web/tests/unit/frontend.test.ts`           |
| The local fold clears the opposite attitude, as the server does                      | `web/tests/unit/frontend.test.ts`           |
| A queued op is superseded in place, and an in-flight one never is                    | `web/tests/unit/syncEngine.test.ts`         |
| A photo op waits for the upload op that creates its row                              | `web/tests/unit/pendingPhotoOps.test.ts`    |
| The server clears the opposite attitude when either is added                         | `src/worker/routes/sync.test.ts`            |
| A translation request writes no row, and only root may ask                           | `src/worker/routes/admin.test.ts`           |
| The cached snapshot round-trips through `metaCache` and is replaced on sync          | `web/tests/unit/oplog.test.ts`              |
| A pending card keeps its Photo identity until a field or mark changes                | `web/tests/unit/pendingPhoto.test.ts`       |
| A pending card holds the local preview until the hosted copy is renderable           | `web/tests/unit/pendingPhoto.test.ts`       |
| A transcode failure renders no card; an upload failure does (§3)                     | `web/tests/unit/pendingPhoto.test.ts`       |
| A card's local preview comes from OPFS, never from the picked file (§3)              | `web/tests/unit/uploadPreview.test.ts`      |
| An unconfirmed `upload` op still renders a card after a failed sync                  | `web/tests/unit/pendingUploadCards.test.ts` |
| A confirmed sync retires those cards, and a landed/live sha never double-draws       | `web/tests/unit/pendingUploadCards.test.ts` |
| Reading the op log for rendering is not a sync request                               | `web/tests/unit/syncEngine.test.ts`         |
| A 200-op `/sync` costs a fixed handful of round trips, not one per op                | `src/worker/routes/sync.test.ts`            |
| A GIF frame duration is read through the one owner, never re-derived in the worker   | `web/tests/unit/gifFrameTiming.test.ts`     |
| A GIF's frame timestamps accumulate, and a zero duration is a missing one            | `web/tests/unit/pipeline.test.ts`           |
| A media URL's extension picks the Markdown element (video / audio / image)           | `web/tests/unit/markdown.test.ts`           |
| Only a real image extension renders in place; a non-media file links                 | `web/tests/unit/markdown.test.ts`           |
| The Markdown media rule emits video/audio/link directly, with no `<img>` placeholder | `web/tests/unit/markdown.test.ts`           |
| A picked file previews locally by MIME **or** file name                              | `web/tests/unit/markdown.test.ts`           |
| The editor uploads any file, not only images and videos                              | `web/tests/unit/editorUpload.test.ts`       |
| The Markdown palette binds `--tw-prose-*` to site tokens, from the right layer       | `web/tests/unit/designTokens.test.ts`       |
| Markdown structure follows GitHub: heading ladder, quote bar, code chip              | `web/tests/unit/designTokens.test.ts`       |
| A block-opening or block-closing image carries no rhythm margin                      | `web/tests/unit/designTokens.test.ts`       |
| No decorative text is injected into a line: quote glyphs and code backticks          | `web/tests/unit/designTokens.test.ts`       |
| A table reads at body size, on a collapsed grid, and scrolls when wide               | `web/tests/unit/designTokens.test.ts`       |
| The font race cancels the losers, and a failed source removes only itself            | `src/shared/fonts.test.ts`                  |
| The error page's CSP hash equals the race script it authorises                       | `src/shared/fonts.test.ts`                  |

The bypass rule covers state transitions only. `animation` timings are out of scope on
purpose: the glitch's `steps(2)` jitter and the upload sweep's `1.3s linear infinite` are
loop timings for a decorative effect and belong to no motion phase. `0s` stays legal — it
is how a property changes instantaneously while sharing a transition list.

Known gaps, in the order they should be closed:

1. **Most of §3 still has no assertions.** The rules that do are listed in the table above (the
   failure-kind split, the OPFS preview source, the card's Photo identity, the media URL's
   element, the glitch palette). The two with the most behaviour and the least coverage are
   `base/lib/overlay.ts` (focus trap, Escape ownership, scroll-lock depth) and `pillMeasure.ts`
   (the delta that drives the pill's shape). `lightboxEngine.ts` is now covered, but nothing
   asserts that the component calls it correctly — an engine can be exhaustively tested and still
   be wired to the wrong event. `web/tests/e2e/ui.spec.ts` covers some overlay and Lightbox
   behaviour but is excluded from CI.
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
