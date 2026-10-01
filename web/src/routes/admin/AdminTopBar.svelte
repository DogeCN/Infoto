<script lang="ts">
  // Admin navigation uses the same measured full → compact → paged density as the gallery bar.
  import { BarChart3, Megaphone, MessageSquare, Plus } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import LocaleToggle from '$lib/components/LocaleToggle.svelte';
  import SegmentedControl, { type SegmentedItem } from '$lib/components/SegmentedControl.svelte';
  import PagerArrow from '$lib/components/PagerArrow.svelte';
  import {
    BAR_PAD,
    barCssVars,
    barHeight,
    resolveBarMode,
    type BarMode,
  } from '$lib/components/topbarFit';
  import AdminMigrateMenu from './AdminMigrateMenu.svelte';

  export type AdminTab = 'announcements' | 'feedback' | 'polls';

  interface Props {
    activeTab: AdminTab;
    onTabChange: (tab: AdminTab) => void;
    onCreate: () => void;
    createActive: boolean;
    onImported: () => Promise<{ ok: boolean; message: string }>;
  }

  let { activeTab, onTabChange, onCreate, createActive, onImported }: Props = $props();

  const tabs = $derived<SegmentedItem<AdminTab>[]>([
    { value: 'announcements', label: copy.admin.tabs.announcements, icon: Megaphone },
    { value: 'feedback', label: copy.admin.tabs.feedback, icon: MessageSquare },
    { value: 'polls', label: copy.admin.tabs.polls, icon: BarChart3 },
  ]);

  let mode = $state<BarMode>('full');
  let screen = $state<0 | 1>(0);
  let barWidth = $state(0);

  const barHeightPx = $derived(barHeight(barWidth));
  const barStyle = $derived(`${barCssVars(barWidth)};height:${barHeightPx}px`);
  const rowStyle = `padding-left:${BAR_PAD}px;padding-right:${BAR_PAD}px`;
  const paged = $derived(mode === 'paged');
  const hideLabels = $derived(mode !== 'full');

  let headerEl: HTMLElement | undefined = $state(undefined);
  let rowEl: HTMLElement | undefined = $state(undefined);
  let actionsEl: HTMLElement | undefined = $state(undefined);
  let fullTabsProbe: HTMLDivElement | undefined = $state(undefined);
  let compactTabsProbe: HTMLDivElement | undefined = $state(undefined);
  let fullTabsWidth = $state(0);
  let compactTabsWidth = $state(0);
  let actionsWidth = $state(0);

  function row(node: HTMLElement): { destroy(): void } {
    rowEl = node;
    return { destroy() {} };
  }

  function toggleScreen(): void {
    screen = screen === 0 ? 1 : 0;
  }

  let pagerGesture: { pointerId: number; x: number; y: number } | null = null;
  function onPagerPointerDown(event: PointerEvent): void {
    if (!paged || event.pointerType === 'mouse') return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea, [role="button"]'))
      return;
    pagerGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onPagerPointerUp(event: PointerEvent): void {
    const start = pagerGesture;
    pagerGesture = null;
    if (!start || start.pointerId !== event.pointerId || !paged) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    screen = dx < 0 ? 1 : 0;
  }

  function onPagerPointerCancel(event: PointerEvent): void {
    if (pagerGesture?.pointerId === event.pointerId) pagerGesture = null;
  }

  function remeasure(): void {
    const width = barWidth;
    if (!width || !fullTabsWidth || !compactTabsWidth || !actionsWidth || !rowEl) {
      return;
    }

    const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
    // Two outer gaps: navigation ↔ spacer ↔ actions (or the page arrow).
    const SINGLE_GAPS = 2;
    const PAGED_GAPS = 2;
    // Both inline paddings are included; the gallery and admin headers share BAR_PAD.
    const horizontalPadding = BAR_PAD * 2;
    const single = (tabsWidth: number) =>
      horizontalPadding + tabsWidth + actionsWidth + SINGLE_GAPS * gap;
    const arrowWidth = 36;
    const pagedNeed = Math.max(
      horizontalPadding + compactTabsWidth + arrowWidth + PAGED_GAPS * gap,
      horizontalPadding + arrowWidth + actionsWidth + PAGED_GAPS * gap,
    );

    const next = resolveBarMode(
      width,
      {
        full: single(fullTabsWidth),
        compact: single(compactTabsWidth),
        paged: pagedNeed,
      },
      mode,
    );
    if (next === mode) return;
    mode = next;
    if (next !== 'paged' && screen !== 0) screen = 0;
  }

  // Measure both tab densities plus the live action group. ResizeObserver keeps the
  // layout in sync with viewport changes, translated labels, and section-dependent actions.
  $effect(() => {
    const header = headerEl;
    const fullProbe = fullTabsProbe;
    const compactProbe = compactTabsProbe;
    const actions = actionsEl;
    if (!header || !fullProbe || !compactProbe || !actions) return;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = headerEl?.clientWidth ?? 0;
        if (width && width !== barWidth) barWidth = width;
        fullTabsWidth = fullTabsProbe?.offsetWidth ?? 0;
        compactTabsWidth = compactTabsProbe?.offsetWidth ?? 0;
        actionsWidth = actionsEl?.offsetWidth ?? 0;
        remeasure();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    observer.observe(fullProbe);
    observer.observe(compactProbe);
    observer.observe(actions);
    window.addEventListener('resize', schedule);
    const fontPass = setTimeout(schedule, 250);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fontPass);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  });
</script>

<!-- Inert intrinsic-size probes supply both tab widths without exposing duplicate controls. -->
<div
  class="pointer-events-none fixed left-0 top-0 flex w-max flex-col items-start opacity-0"
  aria-hidden="true"
  inert
>
  <div bind:this={fullTabsProbe} class="w-max">
    <SegmentedControl items={tabs} value={activeTab} ariaLabel={copy.admin.sectionLabel} />
  </div>
  <div bind:this={compactTabsProbe} class="w-max">
    <SegmentedControl
      items={tabs}
      value={activeTab}
      ariaLabel={copy.admin.sectionLabel}
      hideLabel
    />
  </div>
</div>

<header
  data-admin-topbar
  data-bar-mode={mode}
  data-bar-screen={screen}
  role="region"
  aria-label={copy.admin.sectionLabel}
  bind:this={headerEl}
  class="fixed inset-x-0 top-0 z-40 overflow-hidden touch-pan-y border-b border-border bg-background/80 backdrop-blur-xl backdrop-saturate-150"
  style={barStyle}
  onpointerdown={onPagerPointerDown}
  onpointerup={onPagerPointerUp}
  onpointercancel={onPagerPointerCancel}
>
  {#if paged}
    <!-- Split the navigation and actions across two swipeable screens, like the gallery bar. -->
    <div
      class="flex h-full w-[200%] transition-transform duration-[var(--duration-enter)] ease-[var(--ease-enter)] {screen ===
      1
        ? '-translate-x-1/2'
        : 'translate-x-0'}"
    >
      <div use:row class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
        <SegmentedControl
          items={tabs}
          value={activeTab}
          ariaLabel={copy.admin.sectionLabel}
          onChange={onTabChange}
          hideLabel
        />
        <div class="flex-1"></div>
        <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
      </div>

      <div use:row class="flex h-full w-1/2 shrink-0 items-center gap-1" style={rowStyle}>
        <div class="shrink-0"><PagerArrow {screen} onToggle={toggleScreen} /></div>
        <div class="flex-1"></div>
        {@render actionGroup()}
      </div>
    </div>
  {:else}
    <div use:row class="flex h-full items-center gap-1" style={rowStyle}>
      <SegmentedControl
        items={tabs}
        value={activeTab}
        ariaLabel={copy.admin.sectionLabel}
        onChange={onTabChange}
        hideLabel={hideLabels}
      />
      <div class="flex-1"></div>
      {@render actionGroup()}
    </div>
  {/if}
</header>

{#snippet actionGroup()}
  <div bind:this={actionsEl} class="flex shrink-0 items-center gap-1">
    <LocaleToggle iconClass="size-[calc(var(--bar-h)*0.25)]" />
    {#if activeTab !== 'feedback'}
      <button
        type="button"
        class="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground"
        class:text-primary={createActive}
        aria-label={activeTab === 'polls' ? copy.admin.newPoll : copy.admin.newAnnouncement}
        aria-pressed={createActive}
        onclick={onCreate}
      >
        <Plus class="size-[calc(var(--bar-h)*0.3125)]" />
      </button>
    {/if}
    <AdminMigrateMenu {onImported} />
  </div>
{/snippet}
