<script lang="ts">
  // Fixed top bar with measured full, compact, and two-page densities.
  import { onDestroy, type Snippet } from 'svelte';
  import { Settings, Megaphone, CheckSquare, UploadCloud, Funnel, Plus } from '@lucide/svelte';
  import type { LocaleCode } from '$shared/types';
  import SortPill from './SortPill.svelte';
  import SyncButton from './SyncButton.svelte';
  import PagerArrow from './PagerArrow.svelte';
  import SegmentedControl, { type SegmentedItem } from './SegmentedControl.svelte';
  import LocaleToggle from './LocaleToggle.svelte';
  import type { SortDirections, SortKey } from '../../core/gallery';
  import { BAR_PAD, barCssVars, barHeight, resolveBarMode, type BarMode } from './topbarFit';
  import { scroll } from '../../state/scroll.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    variant?: 'home' | 'admin';
    sortKey?: SortKey;
    /** Secondary direction (newest↔oldest, hottest↔coldest), remembered per sort item. */
    sortDirs?: SortDirections;
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
    adminItems?: ReadonlyArray<SegmentedItem<string>>;
    adminValue?: string;
    onAdminChange?: (value: string) => void;
    onLocaleChange?: (locale: LocaleCode) => void;
    adminCreateLabel?: string;
    adminCreateActive?: boolean;
    onAdminCreateClick?: () => void;
    adminActions?: Snippet;
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

  // The visible sort pill or admin tabs report the same on-screen width plus the
  // measured text contribution, avoiding hidden-copy containing-block measurements.
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
    // Re-evaluate the density here rather than waiting for the header observer. Switching
    // language changes the pill labels, which resizes the pill but not the header, so
    // nothing else would re-run the fit calculation and the bar kept a mode chosen for
    // the previous label widths.
    remeasure();
  }

  // Measure the pager arrow because its width scales with the bar height.
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
    if (!width || !labelledPillW || !iconPillW || !rightBtnsW || !arrowW || !rowEl) return;
    if (isAdmin ? !localeW : !leftExtraW) return;

    const padX = 2 * BAR_PAD;
    const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
    const singleGaps = 3;
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
      { full: single(labelledPillW), compact: single(iconPillW), paged: pagedNeed },
      mode,
    );
    if (next === mode) return;
    mode = next;
    if (next !== 'paged' && screen !== 0) screen = 0;
  }

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
    <button
      type="button"
      class="icon-button p-2"
      class:text-primary={settingsActive}
      onclick={onSettingsClick}
      title={copy.topbar.settings}
      aria-label={copy.topbar.settings}
    >
      <Settings class="size-[calc(var(--bar-h)*0.3125)]" />
    </button>
    {#if filterCount > 0}
      <span
        class="pointer-events-none absolute -right-0.5 -top-0.5 flex size-[calc(var(--bar-h)*0.25)] items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Funnel class="size-[calc(var(--bar-h)*0.15625)]" />
      </span>
    {/if}
  </div>
{/snippet}

{#snippet homeRightGroup()}
  <button
    type="button"
    class="icon-button relative p-2"
    class:text-primary={announcementActive}
    onclick={onAnnouncementClick}
    title={copy.topbar.announcements}
    aria-label={copy.topbar.announcements}
  >
    <Megaphone class="size-[calc(var(--bar-h)*0.3125)]" />
  </button>
  <button
    type="button"
    class="icon-button p-2"
    class:text-primary={multiSelectActive}
    onclick={onMultiSelectClick}
    title={copy.topbar.multiSelect}
    aria-label={copy.topbar.multiSelect}
  >
    <CheckSquare class="size-[calc(var(--bar-h)*0.3125)]" />
  </button>
  <button
    type="button"
    class="icon-button p-2 hover:text-primary"
    onclick={onUploadClick}
    title={copy.topbar.upload}
    aria-label={copy.topbar.upload}
  >
    <UploadCloud class="size-[calc(var(--bar-h)*0.3125)]" />
  </button>
{/snippet}

{#snippet leftGroup()}
  <div class="flex shrink-0 items-center gap-1">
    {@render settingsBtn()}
    <SyncButton {pendingCount} {isSyncing} onSync={onSyncClick} />
  </div>
{/snippet}

{#snippet adminNav()}
  <SegmentedControl
    items={adminItems}
    value={adminValue}
    onChange={onAdminChange}
    hideLabel={mode !== 'full'}
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
      <button
        type="button"
        class="icon-button p-2"
        class:text-primary={adminCreateActive}
        onclick={onAdminCreateClick}
        title={adminCreateLabel}
        aria-label={adminCreateLabel}
        aria-pressed={adminCreateActive}
      >
        <Plus class="size-[calc(var(--bar-h)*0.3125)]" />
      </button>
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
            showLabels={false}
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
      <div class="flex-1"></div>
      {@render adminActionGroup()}
    </div>
  {:else}
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
        {@render homeRightGroup()}
      </div>
    </div>
  {/if}
</header>
