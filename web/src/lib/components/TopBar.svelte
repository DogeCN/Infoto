<script lang="ts">
  // Fixed top bar with measured full, compact, and two-page densities. Labels collapse before pagination activates.
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

  // Roomiest layout until the first measurement. Guessing low would flash the arrow.
  let mode = $state<BarMode>('full');

  /** Observed bar width driving reactive geometry and density. */
  let barW = $state(0);

  // Paged only — one value, not two booleans: there is no third screen, so an integer
  // cannot drift into an invalid pairing.
  let screen = $state<0 | 1>(0);
  function toggleScreen(): void {
    screen = screen === 0 ? 1 : 0;
  }
  const paged = $derived(mode === 'paged');

  // Interpolate bar height from its measured width without rounding fractional pixels.
  const barH = $derived(barHeight(barW));
  const rowStyle = $derived(`padding-left:${BAR_PAD}px;padding-right:${BAR_PAD}px`);

  // ---- measurement -------------------------------------------------------------
  let headerEl: HTMLElement | undefined = $state(undefined);
  /**
   * The single-screen row, or a paged screen. An action, not `bind:this`: two nodes
   * share the variable, and `bind:` would leave a detached element whose padding reads 0.
   */
  let rowEl: HTMLElement | undefined = $state(undefined);
  /** Action form: `use:` passes the node, so the element is captured here. */
  function row(node: HTMLElement): { destroy(): void } {
    rowEl = node;
    return { destroy: () => {} };
  }

  /**
   * Natural width of the labelled pill: the on-screen variant plus the label delta.
   * A hidden copy reports the containing block, not content width.
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
   * Arrow width. Absent from the single-screen DOM, and a hidden copy does not report
   * content width, so this is the button's own box (`p-2` + `size-5`).
   */
  const ARROW_W = 36;

  /**
   * Widths of the two fixed-size control groups, read from probes that stay mounted.
   * The live screen drops one group on a mode switch, so a read there briefly returns 0.
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

    // Use the rendered row gap when calculating the required width.
    const padX = BAR_PAD;
    const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
    // Spacing intervals: three in full mode and two on each paged screen.
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
    // Update reactive width on every observed size change.
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
    // Observe the bar independently of its density-dependent contents.
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

  // Shared control snippets keep measurement probes identical to visible controls.
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

<!-- Inert, zero-height content-width probe outside the header's flex layout. -->
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
    <!-- Two half-width screens on a double-width sliding track. -->
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

        <!-- Fixed-size control on the outer edge of each screen. Width is ARROW_W. -->
        <div class="shrink-0">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>
      </div>

      <div class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
        <div class="shrink-0">
          <PagerArrow {screen} onToggle={toggleScreen} />
        </div>

        <!-- Arrow hard left, buttons hard right: screen 2 mirrors screen 1. -->
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
