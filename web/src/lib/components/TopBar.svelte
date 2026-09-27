<script lang="ts">
  // Top bar. Three densities, resolved from measured widths (see topbarFit.ts) rather
  // than from a viewport breakpoint:
  //
  //   full    — sort labels + all eight controls, one screen
  //   compact — icon-only sort pill + all eight controls, one screen
  //   paged   — icon-only pill, two sliding screens with the flying arrow
  //
  // The bar gives ground one step at a time as it narrows: the labels go first, and
  // only when that is still not enough does the arrow appear. Nothing is decided by
  // guessing how wide a phone is — the old `hidden sm:inline` asked about the viewport,
  // not about whether the pill was actually squeezed, so labels hid at 320px while
  // there was still room and stayed visible while things really were tight.
  //
  // Measurement trick: the inactive pill variant (and the arrow when not paged) stay in
  // the DOM as `invisible absolute`. They leave the flow — no footprint, no geometry
  // change — but still lay out, so their widths are real measurements rather than
  // estimates. A locale change that lengthens the labels re-measures for free.
  //
  // Fixed full width + frosted glass, not sticky (iOS Safari has a known backdrop-filter bug).
  import { Settings, Megaphone, CheckSquare, UploadCloud, Funnel } from '@lucide/svelte';
  import SortPill from './SortPill.svelte';
  import SyncButton from './SyncButton.svelte';
  import PagerArrow from './PagerArrow.svelte';
  import type { SortKey } from './SortTabs.svelte';
  import { BAR_PAD, barHeight, resolveBarMode, type BarMode } from './topbarFit';
  import { scroll } from '../../state/scroll.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    sortKey?: SortKey;
    /** Secondary direction (newest↔oldest, hottest↔coldest), remembered per sort item. */
    sortDirs?: Partial<Record<SortKey, boolean>>;
    onSortChange?: (key: SortKey) => void;
    onSortReshuffle?: () => void;
    onSettingsClick?: () => void;
    onSyncClick?: () => void;
    onAnnouncementClick?: () => void;
    onMultiSelectClick?: () => void;
    onUploadClick?: () => void;
    pendingCount?: number;
    filterCount?: number;
    isSyncing?: boolean;
    settingsActive?: boolean;
    announcementActive?: boolean;
    multiSelectActive?: boolean;
  }

  let {
    sortKey = 'latest',
    sortDirs = {},
    onSortChange,
    onSortReshuffle,
    onSettingsClick,
    onSyncClick,
    onAnnouncementClick,
    onMultiSelectClick,
    onUploadClick,
    pendingCount = 0,
    filterCount = 0,
    isSyncing = false,
    settingsActive = false,
    announcementActive = false,
    multiSelectActive = false,
  }: Props = $props();

  // Immersive top bar: transparent with no border at the start of the main axis (scrollTop when
  // vertical, scrollLeft when horizontal), frosted glass fades in once scrolled.
  let scrolled = $derived(scroll.y > 8 || scroll.x > 8);

  // ---- density resolution ------------------------------------------------------
  // Starts at the roomiest layout: it is the only choice that cannot overflow, so the
  // pre-measurement frame is harmless, whereas guessing low would flash the arrow at
  // every user who never needs it.
  let mode = $state<BarMode>('full');

  /**
   * The bar's own width, mirrored into reactive state by the ResizeObserver below.
   * Everything derived (height, padding, and the fit requirement) reads this rather
   * than measuring the DOM, because a DOM measurement read inside `$derived` is
   * evaluated once and never invalidated.
   */
  let barW = $state(0);

  // Paged only — one value, not two booleans: there is no third screen, so an integer
  // cannot drift into an invalid pairing.
  let screen = $state<0 | 1>(0);
  function toggleScreen(): void {
    screen = screen === 0 ? 1 : 0;
  }
  const paged = $derived(mode === 'paged');

  // Continuous geometry. These replace `h-14 md:h-16` and `px-3 md:px-6`, whose single
  // Continuous height. This replaces `h-14 md:h-16`, whose single 768px breakpoint
  // snapped the bar from 55px to 63px in one pixel — a step change in a bar that is
  // otherwise continuously adaptive. The padding is NOT ramped: it was `px-3 md:px-6`,
  // and at desktop widths that 24px inset pushed the controls away from the window edge
  // for no reason, so it is now a constant `px-3` at every width.
  //
  // The width comes from `barW`, NOT from `headerEl.clientWidth`: a DOM measurement is
  // not reactive, so reading it in a `$derived` computes once and never updates again
  // (observed as a bar frozen at its first computed size at every width).
  // No rounding: the sub-pixel height is deliberate. A device pixel ratio above 1 can
  // render it — at dpr 3.375 (the reference phone) the 56→64px ramp spans 27 device
  // pixels, so fractional CSS values give 27 steps instead of 8. On a dpr-1 desktop the
  // extra precision is simply dropped by the rasteriser, which is exactly the same 8
  // steps as before and no worse.
  const barH = $derived(barHeight(barW));
  const rowStyle = $derived(`padding-left:${BAR_PAD}px;padding-right:${BAR_PAD}px`);

  // ---- measurement -------------------------------------------------------------
  let headerEl: HTMLElement | undefined = $state(undefined);
  /**
   * The single-screen row (or a paged screen). Registered through an action rather than
   * `bind:this` because two different nodes share the variable: `bind:` would leave a
   * stale element behind after a mode switch, and reading padding from a detached node
   * silently yields 0 — which made the requirement collapse and the bar page at 520px.
   */
  let rowEl: HTMLElement | undefined = $state(undefined);
  /** Action form: `use:` passes the node, so the element is captured here. */
  function row(node: HTMLElement): { destroy(): void } {
    rowEl = node;
    return { destroy: () => {} };
  }

  /**
   * Natural width of the labelled pill, derived from whichever variant is on screen plus
   * the label delta. Never measured from a hidden copy — see the note in SortPill for
   * why that number was 42px wrong and made the bar flap.
   */
  let labelledPillW = $state(0);
  let iconPillW = $state(0);

  function onPillWidths(info: {
    shown: number;
    shownIsLabelled: boolean;
    labelDelta: number;
  }): void {
    if (!info.shown) return;
    labelledPillW = info.shownIsLabelled ? info.shown : info.shown + info.labelDelta;
    iconPillW = info.shownIsLabelled ? info.shown - info.labelDelta : info.shown;
  }

  /**
   * The arrow's width. It is not in the single-screen DOM at all, so reading it there
   * gave 0 and understated the paged requirement. It is also not measurable from a
   * hidden copy for the same reason as the pill, so it is a constant derived from the
   * button's own classes (`p-2` + `size-5` + border) — fixed by construction, and the
   * one control whose size cannot vary with content.
   */
  const ARROW_W = 36;

  /**
   * The two fixed-size control groups, measured from hidden in-flow probes rather than
   * from whichever screen is currently rendered.
   *
   * These are five fixed-size icon buttons whose widths cannot vary with content or
   * locale, so they are constants of the markup. Reading them off the live screen was
   * another instance of the same mistake: when the mode flips, the bindings move to the
   * paged rows, where one group is absent, so the requirement briefly read 0 for it and
   * the bar could jump two modes at once. Measuring them once, from nodes that are
   * always laid out, removes the feedback entirely.
   */
  let groupProbeEl: HTMLElement | undefined = $state(undefined);
  let leftExtraW = $state(0);
  let rightBtnsW = $state(0);
  $effect(() => {
    const probe = groupProbeEl;
    if (!probe) return;
    const [left, right] = [...probe.children].map((c) => (c as HTMLElement).offsetWidth);
    if (left) leftExtraW = left;
    if (right) rightBtnsW = right;
  });

  function remeasure(): void {
    // The reactive width, not a fresh DOM read: the bar is otherwise measured from stale
    // geometry and decides from numbers that no longer match what is on screen.
    const bar = barW;
    // Everything is required: a stale 0 would read as "fits" and the bar would never
    // page. `bar` is 0 only before the header is laid out.
    if (!bar || !labelledPillW || !iconPillW || !leftExtraW || !rightBtnsW || !rowEl) return;

    // The padding is the same constant the row is rendered with, so the requirement can
    // never disagree with what is on screen. (Reading it back off the row worked, but
    // two earlier attempts re-derived it in JS — one re-implemented Tailwind's `md:`
    // breakpoint, another counted two `gap-1` intervals where the row has three — and
    // each mistake shifted the threshold enough to overflow a 13px window.)
    const padX = BAR_PAD;
    const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
    // One screen has four items (pill, left group, spacer, right group) → 3 intervals.
    // Each paged screen also has three (pill, left, spacer, arrow | arrow, right group)
    // → 2 intervals. These are structural, so they are written down rather than counted,
    // and the markup keeps them in step (see the two `{#if}` arms).
    const SINGLE_GAPS = 3;
    const PAGED_GAPS = 2;

    // One screen: the flexible spacer absorbs slack, so only the always-present gaps count.
    const single = (pill: number): number =>
      padX + pill + leftExtraW + rightBtnsW + SINGLE_GAPS * gap;
    // Paged: two screens, each carrying its own padding; the track must satisfy the wider.
    const pagedNeed = Math.max(
      padX + iconPillW + leftExtraW + ARROW_W + PAGED_GAPS * gap,
      padX + ARROW_W + rightBtnsW + PAGED_GAPS * gap,
    );

    const next = resolveBarMode(
      bar,
      { full: single(labelledPillW), compact: single(iconPillW), paged: pagedNeed },
      mode,
    );
    if (next === mode) return;
    mode = next;
    // Leaving paged must not strand the user on a screen that no longer exists.
    if (next !== 'paged' && screen !== 0) screen = 0;
  }

  // Re-measure on width changes and whenever a measured width can have moved (label text
  // on locale switch, badge counts, sync state). rAF-coalesced: a drag or a rotation
  // fires a burst of these.
  $effect(() => {
    if (!headerEl) return;
    let raf = 0;
    // The width is mirrored into `barW` here because that is what makes the geometry
    // reactive — and `barW` must be set on *every* observed size, not only when the
    // derived density changes, or the bar keeps whatever height it first computed.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = headerEl?.clientWidth ?? 0;
        if (w && w !== barW) barW = w;
        remeasure();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(headerEl);
    // Only the bar itself: every measured width is either a fixed-size group (from the
    // probe) or the pill (reported in-flow by SortPill), so no live node is observed and
    // nothing can feed the decision back into itself.
    window.addEventListener('resize', schedule);
    // One late pass: a web-font swap can shift the label widths after first paint.
    const t = setTimeout(schedule, 250);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  });

  // ---- markup, defined once ----------------------------------------------------
  // The two control groups are snippets rather than duplicated markup so that the
  // width-measuring probe below renders *exactly* the same controls as the live bar. A
  // hand-copied probe would silently drift from the real thing and report a width for a
  // control that no longer exists.
</script>

{#snippet settingsBtn()}
  <div class="relative">
    <button
      type="button"
      class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
      class:text-primary={settingsActive}
      onclick={onSettingsClick}
      title={copy.topbar.settings}
      aria-label={copy.topbar.settings}
    >
      <Settings class="size-5" />
    </button>
    {#if filterCount > 0}
      <span
        class="pointer-events-none absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Funnel class="size-2.5" />
      </span>
    {/if}
  </div>
{/snippet}

{#snippet rightGroup()}
  <button
    type="button"
    class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
    class:text-primary={announcementActive}
    onclick={onAnnouncementClick}
    title={copy.topbar.announcements}
    aria-label={copy.topbar.announcements}
  >
    <Megaphone class="size-5" />
  </button>
  <button
    type="button"
    class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
    class:text-primary={multiSelectActive}
    onclick={onMultiSelectClick}
    title={copy.topbar.multiSelect}
    aria-label={copy.topbar.multiSelect}
  >
    <CheckSquare class="size-5" />
  </button>
  <button
    type="button"
    class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
    onclick={onUploadClick}
    title={copy.topbar.upload}
    aria-label={copy.topbar.upload}
  >
    <UploadCloud class="size-5" />
  </button>
{/snippet}

{#snippet leftGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {@render settingsBtn()}
    <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
  </div>
{/snippet}

<!-- Always-mounted copies of the two fixed-size control groups, used only to read
       their widths. Rendered *outside* the header: inside it the element would either
       become a flex child and steal space, or — if `fixed`/`absolute` — become the
       containing block for the paged `w-[200%]` track and drag both screens off-screen.

       `w-max` is what makes the width a content width (`absolute`/`fixed` shrink-to-fit
       resolves against the containing block instead, which is how the sort pill's hidden
       twin read 215px against a true 258px). `opacity-0` rather than `visibility: hidden`
       because `visibility` is inherited but overridable by a descendant, and a real
       button was in fact painting at the viewport origin. `height: 0` + `overflow: visible`
       keeps the row from adding any height. `inert` keeps the invisible controls out of
       the tab order. -->
<div
  bind:this={groupProbeEl}
  class="pointer-events-none flex w-max items-center gap-1 opacity-0"
  style="position: fixed; left: 0; top: 0; height: 0"
  aria-hidden="true"
  inert
>
  {@render leftGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {@render rightGroup()}
  </div>
</div>

<header
  bind:this={headerEl}
  class="fixed top-0 left-0 right-0 z-40 overflow-hidden {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
  style="height: {barH}px"
>
  {#if paged}
    <!-- Two screens on one sliding track: the arrow genuinely travels across the bar
         instead of two sets cross-fading. `w-[200%]` with each screen at half of it
         means a −50% shift lands exactly on screen 2 at any bar width. -->
    <div
      class="flex h-full w-[200%] transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] {screen ===
      1
        ? '-translate-x-1/2'
        : 'translate-x-0'}"
    >
      <div use:row class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
        <SortPill
          {sortKey}
          dirs={sortDirs}
          onChange={onSortChange}
          onReshuffle={onSortReshuffle}
          showLabels={false}
          onWidths={onPillWidths}
        />
        {@render leftGroup()}

        <div class="flex-1"></div>

        <!-- The arrow rides at the far edge of *each* screen, so the control that brings
             you here is the control that takes you back. It is a fixed-size control, so
             its width is a constant (ARROW_W) rather than something measured — measuring
             a control that is not in this DOM is how the paged requirement got
             understated before. -->
        <div class="shrink-0">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>
      </div>

      <div class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
        <div class="shrink-0">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>

        <!-- The arrow stays hard left (it is the way back) while the buttons hug the
             right edge, so screen 2 mirrors screen 1's balance: a control at each end,
             nothing stranded in the middle. -->
        <div class="flex-1"></div>

        <div class="flex shrink-0 items-center gap-1">
          {@render rightGroup()}
        </div>
      </div>
    </div>
  {:else}
    <!-- One screen: the flexible spacer between the groups absorbs the slack, so the
         bar only needs to hold every control exactly once. -->
    <div use:row class="flex h-full items-center gap-1" style={rowStyle}>
      <SortPill
        {sortKey}
        dirs={sortDirs}
        onChange={onSortChange}
        onReshuffle={onSortReshuffle}
        showLabels={mode === 'full'}
        onWidths={onPillWidths}
      />
      {@render leftGroup()}

      <div class="flex-1"></div>

      <div class="flex shrink-0 items-center gap-1">
        {@render rightGroup()}
      </div>
    </div>
  {/if}
</header>
