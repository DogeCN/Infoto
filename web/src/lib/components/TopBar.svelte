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
  import { barPadX, resolveBarMode, type BarMode } from './topbarFit';
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

  // Paged only — one value, not two booleans: there is no third screen, so an integer
  // cannot drift into an invalid pairing.
  let screen = $state<0 | 1>(0);
  function toggleScreen(): void {
    screen = screen === 0 ? 1 : 0;
  }
  const paged = $derived(mode === 'paged');

  // ---- measurement -------------------------------------------------------------
  let headerEl: HTMLElement | undefined = $state(undefined);
  let pillFullEl: HTMLElement | undefined = $state(undefined);
  let pillCompactEl: HTMLElement | undefined = $state(undefined);
  let leftExtraEl: HTMLElement | undefined = $state(undefined);
  let rightBtnsEl: HTMLElement | undefined = $state(undefined);
  let arrowEl: HTMLElement | undefined = $state(undefined);

  /** Gap between the control groups inside a screen (matches the `gap-1` class). */
  const GAP = 4;

  /** Out of flow but still laid out: measurable, zero footprint. */
  const off = 'invisible absolute';

  function onPillMeasure(full: HTMLElement, compact: HTMLElement): void {
    pillFullEl = full;
    pillCompactEl = compact;
  }

  function remeasure(): void {
    const bar = headerEl?.clientWidth ?? 0;
    const pillFull = pillFullEl?.offsetWidth ?? 0;
    const pillCompact = pillCompactEl?.offsetWidth ?? 0;
    const leftExtra = leftExtraEl?.offsetWidth ?? 0;
    const rightBtns = rightBtnsEl?.offsetWidth ?? 0;
    const arrow = arrowEl?.offsetWidth ?? 0;
    // The arrow is legitimately 0 before it has been laid out once; everything else is
    // required, otherwise a stale 0 would read as "fits" and the bar would never page.
    if (!bar || !pillFull || !pillCompact || !leftExtra || !rightBtns) return;

    const pad = barPadX(bar) * 2;
    // One screen: the flexible spacer absorbs slack, so only the always-present gaps count.
    const single = (pill: number): number => pad + pill + GAP + leftExtra + rightBtns;
    // Paged: each screen carries its own padding; the track must satisfy the wider one.
    const pagedNeed = Math.max(pad + pillCompact + GAP + leftExtra, pad + arrow + GAP + rightBtns);

    const next = resolveBarMode(bar, {
      full: single(pillFull),
      compact: single(pillCompact),
      paged: pagedNeed,
    });
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
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(remeasure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(headerEl);
    for (const el of [pillFullEl, pillCompactEl, leftExtraEl, rightBtnsEl, arrowEl]) {
      if (el) ro.observe(el);
    }
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
</script>

<header
  bind:this={headerEl}
  class="fixed top-0 left-0 right-0 z-40 h-14 overflow-hidden md:h-16 {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
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
      <div class="flex h-full w-1/2 shrink-0 items-center gap-1 px-3 md:px-6">
        <SortPill
          {sortKey}
          dirs={sortDirs}
          onChange={onSortChange}
          onReshuffle={onSortReshuffle}
          showLabels={false}
          onMeasure={onPillMeasure}
        />
        <div bind:this={leftExtraEl} class="flex shrink-0 items-center gap-1">
          <div class="relative">
            <button
              type="button"
              class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
              class:text-primary={settingsActive}
              onclick={onSettingsClick}
              title={copy.topbar.settings}
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
          <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
        </div>
      </div>

      <div class="flex h-full w-1/2 shrink-0 items-center gap-1 px-3 md:px-6">
        <div bind:this={arrowEl} class="shrink-0">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>
        <div bind:this={rightBtnsEl} class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
            class:text-primary={announcementActive}
            onclick={onAnnouncementClick}
            title={copy.topbar.announcements}
          >
            <Megaphone class="size-5" />
          </button>
          <button
            type="button"
            class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
            class:text-primary={multiSelectActive}
            onclick={onMultiSelectClick}
            title={copy.topbar.multiSelect}
          >
            <CheckSquare class="size-5" />
          </button>
          <button
            type="button"
            class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
            onclick={onUploadClick}
            title={copy.topbar.upload}
          >
            <UploadCloud class="size-5" />
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- One screen: the flexible spacer between the groups absorbs the slack, so the
         bar only needs to hold every control exactly once. -->
    <div class="flex h-full items-center gap-1 px-3 md:px-6">
      <SortPill
        {sortKey}
        dirs={sortDirs}
        onChange={onSortChange}
        onReshuffle={onSortReshuffle}
        showLabels={mode === 'full'}
        onMeasure={onPillMeasure}
      />
      <div bind:this={leftExtraEl} class="flex shrink-0 items-center gap-1">
        <div class="relative">
          <button
            type="button"
            class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
            class:text-primary={settingsActive}
            onclick={onSettingsClick}
            title={copy.topbar.settings}
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
        <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
      </div>

      <div class="flex-1"></div>

      <div bind:this={rightBtnsEl} class="relative flex shrink-0 items-center gap-1">
        <!-- Out of flow while paged is off, so it costs no space but stays measurable. -->
        <div bind:this={arrowEl} class={off} aria-hidden="true">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>
        <button
          type="button"
          class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
          class:text-primary={announcementActive}
          onclick={onAnnouncementClick}
          title={copy.topbar.announcements}
        >
          <Megaphone class="size-5" />
        </button>
        <button
          type="button"
          class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
          class:text-primary={multiSelectActive}
          onclick={onMultiSelectClick}
          title={copy.topbar.multiSelect}
        >
          <CheckSquare class="size-5" />
        </button>
        <button
          type="button"
          class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-primary"
          onclick={onUploadClick}
          title={copy.topbar.upload}
        >
          <UploadCloud class="size-5" />
        </button>
      </div>
    </div>
  {/if}
</header>
