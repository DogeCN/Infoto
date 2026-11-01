<script lang="ts">
  // Fixed top bar with measured full, compact, and two-page densities.
  import { onDestroy, type Snippet } from 'svelte';
  import { Settings, Megaphone, CheckSquare, UploadCloud, Funnel, Plus } from '@lucide/svelte';
  import type { LocaleCode } from '$shared/types';
  import SortPill from './SortPill.svelte';
  import SyncButton from './SyncButton.svelte';
  import PagerArrow from './PagerArrow.svelte';
  import TooltipIconButton from './TooltipIconButton.svelte';
  import SegmentedControl, { type SegmentedItem } from './SegmentedControl.svelte';
  import LocaleToggle from './LocaleToggle.svelte';
  import type { SortDirections, SortKey } from '../../core/gallery';
  import { BAR_PAD, barCssVars, barHeight, resolveBarMode, type BarMode } from './topbarFit';
  import type { PillWidths } from './pillMeasure';
  import { scroll } from '../../state/scroll.svelte';
  import { barHeightPx } from '../../state/barHeight.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    variant?: 'home' | 'admin';
    sortKey?: SortKey;
    /** Secondary direction (newest↔oldest, hottest↔coldest), remembered per sort item. */
    sortDirs?: SortDirections;
    onSortChange?: (key: SortKey) => void;
    onSortReshuffle?: () => void;
    onSettingsClick?: () => void;
    onSyncClick?: () => Promise<void>;
    onAnnouncementClick?: () => void;
    onMultiSelectClick?: () => void;
    onUploadClick?: () => void;
    pendingCount?: number;
    filterCount?: number;
    isSyncing?: boolean;
    /** Whether the /ws session is open and authenticated; the sync button hides while
     *  it is, because a connected client syncs without being told to (ADR 0026). */
    connected?: boolean;
    settingsActive?: boolean;
    announcementActive?: boolean;
    multiSelectActive?: boolean;
    adminItems?: ReadonlyArray<SegmentedItem<string>>;
    adminValue?: string;
    onAdminChange?: (value: string) => void;
    onLocaleChange?: (locale: LocaleCode) => void;
    adminCreateLabel?: string;
    adminCreateActive?: boolean;
    onAdminCreateClick?: () => void;
    adminActions?: Snippet;
    /** Double-tap on the bar's non-control area scrolls the gallery to the top. */
    onScrollToTop?: () => void;
  }

  let {
    variant = 'home',
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
    connected = false,
    settingsActive = false,
    announcementActive = false,
    multiSelectActive = false,
    adminItems = [],
    adminValue = '',
    onAdminChange,
    onLocaleChange,
    adminCreateLabel,
    adminCreateActive = false,
    onAdminCreateClick,
    adminActions,
    onScrollToTop,
  }: Props = $props();

  // Home is immersive; the admin header stays frosted because its document scrolls behind it.
  let scrolled = $derived(variant === 'admin' || scroll.y > 8 || scroll.x > 8);
  let mode = $state<BarMode>('full');
  let barW = $state(0);
  let screen = $state<0 | 1>(0);
  const paged = $derived(mode === 'paged');
  const barH = $derived(barHeight(barW));
  const barStyle = $derived(`${barCssVars(barW)};height:${barH}px`);
  const rowStyle = $derived(`padding-left:${BAR_PAD}px;padding-right:${BAR_PAD}px`);

  let headerEl: HTMLElement | undefined = $state(undefined);
  let rowEl: HTMLElement | undefined = $state(undefined);
  function row(node: HTMLElement): { destroy(): void } {
    rowEl = node;
    return { destroy: () => {} };
  }

  /** Double-tap on the bar's non-control area scrolls the gallery to the top. */
  let lastBarTap = 0;
  const BAR_DOUBLE_TAP_MS = 300;
  function onBarPointerDown(event: PointerEvent): void {
    // Ignore taps on interactive controls; they have their own handlers.
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)
      return;
    const now = Date.now();
    if (now - lastBarTap <= BAR_DOUBLE_TAP_MS && onScrollToTop) {
      onScrollToTop();
    }
    lastBarTap = now;
  }

  /**
   * Pill widths per label shape, measured by the shared clone probe. The density resolves
   * from these across four stages: `full` fits the all-labelled pill, `compact` fits the
   * current-item-labelled pill, `icon` fits the icon-only pill on one screen (the pill's
   * third fold, no arrow), and `paged` lays that same icon-only pill across two screens
   * with an arrow — reached only once even the icon-only single screen will not fit.
   */
  let labelledPillW = $state(0);
  let currentPillW = $state(0);
  let iconPillW = $state(0);
  function onPillWidths(info: PillWidths): void {
    if (!info.shown) return;
    labelledPillW = info.labelled;
    currentPillW = info.current;
    iconPillW = info.icon;
    // Re-evaluate the density here rather than waiting for the header observer. Switching
    // language changes the pill labels, which resizes the pill but not the header, so
    // nothing else would re-run the fit calculation and the bar kept a mode chosen for
    // the previous label widths.
    remeasure();
  }

  /**
   * Arrow width comes from a mounted probe: the arrow is absent from the single-screen
   * DOM, and a hidden copy does not report content width, so the button's own box is the
   * only honest measurement.
   */
  let arrowProbeEl: HTMLElement | undefined = $state(undefined);
  let groupProbeEl: HTMLElement | undefined = $state(undefined);
  let leftExtraW = $state(0);
  let localeW = $state(0);
  let rightBtnsW = $state(0);
  let arrowW = $state(0);
  let localeProbeEl: HTMLElement | undefined = $state(undefined);

  $effect(() => {
    // Measure control groups after the bar dimensions or admin labels change.
    void barW;
    void variant;
    void adminItems;
    void adminValue;
    void adminCreateLabel;
    void adminCreateActive;
    const probe = groupProbeEl;
    if (!probe) return;
    const widths = [...probe.children].map((child) => (child as HTMLElement).offsetWidth);
    if (variant === 'admin') {
      const locale = localeProbeEl?.offsetWidth ?? 0;
      if (locale) localeW = locale;
      if (widths[2]) rightBtnsW = widths[2];
    } else {
      if (widths[0]) leftExtraW = widths[0];
      if (widths[1]) rightBtnsW = widths[1];
    }
    const arrow = arrowProbeEl?.offsetWidth ?? 0;
    if (arrow) arrowW = arrow;
  });

  function remeasure(): void {
    const width = barW;
    const isAdmin = variant === 'admin';
    if (!width || !labelledPillW || !currentPillW || !iconPillW || !rightBtnsW || !arrowW || !rowEl)
      return;
    if (isAdmin ? !localeW : !leftExtraW) return;

    const padX = 2 * BAR_PAD;
    const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
    // Spacing intervals: two on the single screen (pill↔left, left↔right, the latter via
    // ml-auto), three on the first paged screen, two on the second.
    const singleGaps = 2;
    const pagedFirstGaps = 3;
    const pagedSecondGaps = 2;
    const single = (pill: number): number =>
      padX + pill + (isAdmin ? localeW : leftExtraW) + rightBtnsW + singleGaps * gap;
    const pagedNeed = Math.max(
      padX + iconPillW + (isAdmin ? localeW : leftExtraW) + arrowW + pagedFirstGaps * gap,
      padX + arrowW + rightBtnsW + pagedSecondGaps * gap,
    );

    const next = resolveBarMode(
      width,
      // Compact density shows the current item's label only, so its requirement is the
      // mixed-shape pill width, not the icon-only one. `icon` is the icon-only pill on a
      // single screen; `paged` is that same pill split across two screens with an arrow.
      {
        full: single(labelledPillW),
        compact: single(currentPillW),
        icon: single(iconPillW),
        paged: pagedNeed,
      },
      mode,
    );
    if (next === mode) return;
    mode = next;
    if (next !== 'paged' && screen !== 0) screen = 0;
  }

  // The bar is the project's single measurement of its own chrome: publish --bar-h on
  // the root element and mirror it into shared state, so anything laid out beneath it
  // (gallery inset, admin editor dialogs) offsets by the measured value instead of
  // restating the height formula against a width it measured on its own.
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty('--bar-h', `${barH}px`);
    barHeightPx.value = barH;
    return () => {
      root.style.removeProperty('--bar-h');
      barHeightPx.value = 0;
    };
  });

  // Re-measure on width changes and whenever a measured width can have moved (label text
  // on locale switch, badge counts, sync state). rAF-coalesced: a drag or a rotation
  // fires a burst of these.
  $effect(() => {
    const header = headerEl;
    if (!header) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = headerEl?.clientWidth ?? 0;
        if (width && width !== barW) barW = width;
        remeasure();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    window.addEventListener('resize', schedule);
    const timeout = setTimeout(schedule, 250);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  });

  function toggleScreen(): void {
    screen = screen === 0 ? 1 : 0;
  }

  // Horizontal pointer swipe toggles the two measured screens. Small movements remain clicks.
  let stopPagerSwipe = () => {};
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  function onPagerPointerDown(event: PointerEvent): void {
    if (!paged || event.button !== 0 || event.target instanceof HTMLInputElement) return;
    stopPagerSwipe();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let horizontal = false;
    let handled = false;
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      stopPagerSwipe = () => {};
      if (handled) {
        suppressClick = true;
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => (suppressClick = false), 120);
      }
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (!horizontal) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.15) {
          finish(next);
          return;
        }
        horizontal = true;
      }
      if (Math.abs(dx) < 42 || handled) return;
      handled = true;
      next.preventDefault();
      if ((screen === 0 && dx < 0) || (screen === 1 && dx > 0)) toggleScreen();
    };
    stopPagerSwipe = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function suppressSwipedClick(event: MouseEvent): void {
    if (!suppressClick) return;
    suppressClick = false;
    clearTimeout(suppressTimer);
    event.preventDefault();
    event.stopPropagation();
  }
  onDestroy(() => {
    stopPagerSwipe();
    clearTimeout(suppressTimer);
  });
</script>

{#snippet settingsBtn()}
  <div class="relative">
    <TooltipIconButton
      text={copy.topbar.settings}
      side="bottom"
      active={settingsActive}
      class="p-2"
      onclick={onSettingsClick}
    >
      <Settings class="size-[var(--bar-icon)]" />
    </TooltipIconButton>
    {#if filterCount > 0}
      <span
        class="pointer-events-none absolute -right-0.5 -top-0.5 flex size-[var(--bar-badge)] items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Funnel class="size-[var(--bar-badge-text)]" />
      </span>
    {/if}
  </div>
{/snippet}

{#snippet homeRightGroup()}
  <TooltipIconButton
    text={copy.topbar.announcements}
    side="bottom"
    active={announcementActive}
    class="relative p-2"
    onclick={onAnnouncementClick}
  >
    <Megaphone class="size-[var(--bar-icon)]" />
  </TooltipIconButton>
  <TooltipIconButton
    text={copy.topbar.multiSelect}
    side="bottom"
    active={multiSelectActive}
    class="p-2"
    onclick={onMultiSelectClick}
  >
    <CheckSquare class="size-[var(--bar-icon)]" />
  </TooltipIconButton>
  <TooltipIconButton
    text={copy.topbar.upload}
    side="bottom"
    class="p-2 hover:text-primary"
    onclick={onUploadClick}
  >
    <UploadCloud class="size-[var(--bar-icon)]" />
  </TooltipIconButton>
{/snippet}

{#snippet leftGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {@render settingsBtn()}
    {#if !connected}
      <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
    {/if}
  </div>
{/snippet}

{#snippet adminNav()}
  <SegmentedControl
    items={adminItems}
    value={adminValue}
    onChange={onAdminChange}
    labelMode={mode === 'full' ? 'all' : mode === 'compact' ? 'current' : 'none'}
    size="sm"
    ariaLabel={copy.admin.sectionLabel}
    onWidths={onPillWidths}
  />
{/snippet}

{#snippet adminNavGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {@render adminNav()}
    <LocaleToggle variant="topbar" onChange={onLocaleChange} />
  </div>
{/snippet}

{#snippet adminActionGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {#if adminCreateLabel}
      <TooltipIconButton
        text={adminCreateLabel}
        side="bottom"
        active={adminCreateActive}
        ariaPressed={adminCreateActive}
        class="p-2"
        onclick={onAdminCreateClick}
      >
        <Plus class="size-[var(--bar-icon)]" />
      </TooltipIconButton>
    {/if}
    {#if adminActions}{@render adminActions()}{/if}
  </div>
{/snippet}

<!-- Inert, zero-height probes use the same controls as the live bar. -->
<div
  bind:this={groupProbeEl}
  class="pointer-events-none flex w-max items-center gap-1 opacity-0"
  style="{barCssVars(barW)};position: fixed; left: 0; top: 0; height: 0"
  aria-hidden="true"
  inert
>
  {#if variant === 'admin'}
    {@render adminNav()}
    <div bind:this={localeProbeEl} class="flex shrink-0 items-center">
      <LocaleToggle variant="topbar" onChange={onLocaleChange} />
    </div>
    {@render adminActionGroup()}
  {:else}
    {@render leftGroup()}
    <div class="flex shrink-0 items-center gap-1">
      {@render homeRightGroup()}
    </div>
  {/if}
  <!-- Same control the live pager renders, so its measured width is the one that counts. -->
  <div bind:this={arrowProbeEl} class="flex shrink-0 items-center">
    <PagerArrow {screen} />
  </div>
</div>

<header
  bind:this={headerEl}
  class="fixed top-0 left-0 right-0 z-40 overflow-hidden touch-pan-y {scrolled
    ? 'border-b border-border bg-background/70 backdrop-blur-xl backdrop-saturate-150'
    : 'border-b border-transparent bg-transparent'}"
  style={barStyle}
  role="region"
  aria-label={variant === 'admin' ? copy.admin.toolbarLabel : copy.topbar.controlsLabel}
  onpointerdown={onPagerPointerDown}
  onpointerdowncapture={onBarPointerDown}
  onclickcapture={suppressSwipedClick}
>
  {#if paged}
    <div
      class="flex h-full w-[200%] transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] {screen ===
      1
        ? '-translate-x-1/2'
        : 'translate-x-0'}"
    >
      {#if variant === 'admin'}
        <div use:row class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
          {@render adminNavGroup()}
          <div class="flex-1"></div>
          <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
        </div>
        <div class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
          <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
          <div class="flex-1"></div>
          {@render adminActionGroup()}
        </div>
      {:else}
        <div use:row class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
          <SortPill
            {sortKey}
            dirs={sortDirs}
            onChange={onSortChange}
            onReshuffle={onSortReshuffle}
            labelMode={mode === 'full' ? 'all' : mode === 'compact' ? 'current' : 'none'}
            onWidths={onPillWidths}
          />
          {@render leftGroup()}
          <div class="flex-1"></div>
          <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
        </div>
        <div class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
          <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
          <div class="flex-1"></div>
          <div class="flex shrink-0 items-center gap-1">
            {@render homeRightGroup()}
          </div>
        </div>
      {/if}
    </div>
  {:else if variant === 'admin'}
    <div use:row class="flex h-full items-center gap-1" style={rowStyle}>
      {@render adminNavGroup()}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        {@render adminActionGroup()}
      </div>
    </div>
  {:else}
    <div use:row class="flex h-full items-center gap-1" style={rowStyle}>
      <SortPill
        {sortKey}
        dirs={sortDirs}
        onChange={onSortChange}
        onReshuffle={onSortReshuffle}
        labelMode={mode === 'full' ? 'all' : mode === 'compact' ? 'current' : 'none'}
        onWidths={onPillWidths}
      />
      {@render leftGroup()}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        {@render homeRightGroup()}
      </div>
    </div>
  {/if}
</header>
