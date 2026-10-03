<script lang="ts" module>
  /** The layout slider under the pointer, or null. The waterfall reflows while one of them
   *  is dragged, so the panel chrome goes fully transparent — except that slider's own row,
   *  which stays opaque so the drag cue never disappears. */
  export type LayoutPreviewControl = 'band' | 'gap' | null;
</script>

<script lang="ts">
  import {
    Upload,
    ThumbsUp,
    ThumbsDown,
    Flag,
    Image,
    ImagePlay,
    Video,
    ArrowDownToLine,
    ArrowRightToLine,
    Rows3,
    Columns3,
    MoveHorizontal,
    Ruler,
    RotateCcw,
    Flame,
    HardDrive,
    LayoutGrid,
    Funnel,
  } from '@lucide/svelte';
  import { cn } from '$base/lib/ui';
  import type { ScrollDir, FillStrategy } from '$base/lib/layout';
  import { MAX_BAND, MIN_BAND } from '$base/lib/band';
  import { onDestroy, type Component } from 'svelte';
  import type { LocaleCode, MediaType, Photo } from '$shared/types';
  import {
    defaultSettings,
    defaultFilterSettings,
    loadSettings,
    saveSettings,
    countActiveFilters,
    isFilterable,
    metricRange,
    RANGE_KEYS,
    type RangeKey,
    type Settings,
  } from '../../settings';
  import { compactSize } from '$base/lib/format';
  import TriStateToggle from './TriStateToggle.svelte';
  import RangeSlider from './RangeSlider.svelte';
  import SingleSlider from './SingleSlider.svelte';
  import Tooltip from './Tooltip.svelte';
  import { toast } from 'svelte-sonner';
  import { copy } from '$lib/i18n.svelte';
  import LocaleToggle from './LocaleToggle.svelte';

  interface Props {
    onSettingsChange?: (settings: Settings) => void;
    /** Source photos for computing dynamic ranges. */
    photos?: Photo[];
    onFilterCount?: (count: number) => void;
    onLocaleChange?: (locale: LocaleCode) => void;
    /** Which layout slider is being dragged, or null. Drives the panel fade. */
    onLayoutPreviewChange?: (control: LayoutPreviewControl) => void;
  }

  let {
    onSettingsChange,
    photos = [],
    onFilterCount,
    onLocaleChange,
    onLayoutPreviewChange,
  }: Props = $props();
  let settings = $state<Settings>(loadSettings());

  /** The layout slider under the pointer. Reported upward so the parent can clear its own
   *  background; also read here so every region except the live row goes transparent. */
  let previewing = $state<LayoutPreviewControl>(null);
  $effect(() => onLayoutPreviewChange?.(previewing));

  // Debounced localStorage writes: syncing at 60fps while dragging blocks the
  // main thread. Call the parent immediately (instant layout / filters) and
  // coalesce localStorage writes with a 200ms delay.
  let _saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    onSettingsChange?.(settings);
    if (_saveTimer !== undefined) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = undefined;
      saveSettings(settings);
    }, 200);
    return () => {
      if (_saveTimer !== undefined) {
        clearTimeout(_saveTimer);
        saveSettings(settings);
      }
    };
  });

  let activeFilterCount = $derived(countActiveFilters(settings.filters));

  /** Factory defaults for layout (drives non-default highlighting). */
  const LAYOUT_DEFAULTS = $derived(defaultSettings().layout);

  /** Whether the range section has no filterable items (no metadata or every
   *  range is min = max). */
  let noFilterableRange = $derived(
    photos.length === 0 || RANGE_KEYS.every((k) => !isFilterable(photos, k)),
  );

  /** Leading icons for the range rows. */
  const RANGE_ICONS: Record<RangeKey, Component> = {
    heat: Flame,
    likes: ThumbsUp,
    dislikes: ThumbsDown,
    reports: Flag,
    size: HardDrive,
  };

  /** Current range for a key: the user value, otherwise the full dynamic
   *  range. */
  function rangeValue(key: RangeKey): [number, number] {
    const full = metricRange(photos, key) ?? [0, 0];
    return settings.filters.ranges[key] ?? full;
  }

  /** Whether a stored range differs from the full range (active highlight). */
  function rangeActive(key: RangeKey): boolean {
    const v = settings.filters.ranges[key];
    if (!v) return false;
    const full = metricRange(photos, key);
    if (!full) return false;
    return v[0] !== full[0] || v[1] !== full[1];
  }

  function setRange(key: RangeKey, v: [number, number]) {
    settings = {
      ...settings,
      filters: {
        ...settings.filters,
        ranges: { ...settings.filters.ranges, [key]: v },
      },
    };
  }

  // Report the active filter count (settings-icon badge).
  $effect(() => {
    onFilterCount?.(activeFilterCount);
  });

  function resetFilters() {
    settings = { ...settings, filters: defaultFilterSettings() };
  }

  function resetLayout() {
    settings = { ...settings, layout: defaultSettings().layout };
  }

  let shakingType = $state<MediaType | null>(null);
  let shakeTimer: ReturnType<typeof setTimeout> | undefined;
  const TYPE_OPTIONS = $derived<ReadonlyArray<{ type: MediaType; label: string; icon: Component }>>(
    [
      { type: 0, label: copy.settings.typeImage, icon: Image },
      { type: 1, label: copy.settings.typeAnimated, icon: ImagePlay },
      { type: 2, label: copy.settings.typeVideo, icon: Video },
    ],
  );

  function finishTypeFeedback(type: MediaType): void {
    if (shakingType !== type) return;
    clearTimeout(shakeTimer);
    shakeTimer = undefined;
    shakingType = null;
  }

  onDestroy(() => clearTimeout(shakeTimer));

  function toggleType(t: MediaType) {
    const next = new Set(settings.filters.types);
    if (next.has(t)) {
      if (next.size === 1) {
        shakingType = t;
        clearTimeout(shakeTimer);
        shakeTimer = setTimeout(() => finishTypeFeedback(t), 200);
        toast.error(copy.settings.keepOneType);
        return;
      }
      next.delete(t);
    } else {
      next.add(t);
    }
    settings = { ...settings, filters: { ...settings.filters, types: next } };
  }

  function cycleTriState(field: 'ownedByMe' | 'likedByMe' | 'dislikedByMe' | 'reportedByMe') {
    const cur = settings.filters[field];
    settings = {
      ...settings,
      filters: {
        ...settings.filters,
        [field]: cur === 'off' ? 'only' : cur === 'only' ? 'exclude' : 'off',
      },
    };
  }

  function toggleDir() {
    const dir: ScrollDir = settings.layout.dir === 'v' ? 'h' : 'v';
    settings = { ...settings, layout: { ...settings.layout, dir } };
  }
  function toggleStrategy() {
    const strategy: FillStrategy =
      settings.layout.strategy === 'shortest' ? 'sequential' : 'shortest';
    settings = { ...settings, layout: { ...settings.layout, strategy } };
  }
  function setBand(v: number) {
    settings = { ...settings, layout: { ...settings.layout, band: v } };
  }
  function setGap(v: number) {
    settings = { ...settings, layout: { ...settings.layout, gap: v } };
  }
</script>

<!-- pb-4: the scroll container has no bottom padding (see OverlaySidebar)

     A layout preview hides the panel chrome so the waterfall reads through it, but the
     slider under the pointer stays solid — it is what tells the user the drag is still
     live. The regions that are *not* being dragged therefore go fully transparent, and
     the live slider's own row stays opaque. -->
<div class="space-y-6 pb-4" data-previewing={previewing ?? 'none'}>
  <!-- Filters section -->
  <section
    class="transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {previewing
      ? 'opacity-0'
      : 'opacity-100'}"
  >
    <div class="flex items-center justify-between px-1">
      <h3 class="flex items-center gap-1.5 text-sm font-medium">
        <Funnel class="size-3.5" />{copy.settings.filterSection}
      </h3>
      <Tooltip text={copy.settings.resetFilters} side="bottom">
        <button
          aria-label={copy.settings.resetFilters}
          type="button"
          class="icon-button size-7"
          onclick={resetFilters}
        >
          <RotateCcw class="size-3.5" />
        </button>
      </Tooltip>
    </div>

    <div class="mt-4 space-y-5 px-1">
      <!-- Ranges: rows of icon + dual-thumb slider -->
      <div class="space-y-3.5">
        {#if noFilterableRange}
          <p class="text-xs text-muted-foreground">{copy.settings.hint}</p>
        {:else}
          {#each RANGE_KEYS as key (key)}
            {@const full = metricRange(photos, key)}
            {@const filterable = isFilterable(photos, key)}
            {@const Icon = RANGE_ICONS[key]}
            {@const active = rangeActive(key)}
            {#if full}
              <div class="flex items-center gap-2">
                <Icon
                  class="size-4 shrink-0 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {active
                    ? 'text-primary'
                    : 'text-muted-foreground'} {filterable ? '' : 'opacity-50'}"
                />
                <div class="min-w-0 flex-1">
                  <RangeSlider
                    min={full[0]}
                    max={full[1]}
                    value={rangeValue(key)}
                    scale={key === 'size' ? 'log' : 'linear'}
                    disabled={!filterable}
                    format={key === 'size' ? compactSize : (v) => String(v)}
                    onChange={(v) => setRange(key, v)}
                  />
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      <!-- Ownership: four tri-state toggles -->
      <div class="grid grid-cols-2 gap-2">
        <TriStateToggle
          label={copy.settings.ownedByMe}
          icon={Upload}
          state={settings.filters.ownedByMe}
          onCycle={() => cycleTriState('ownedByMe')}
        />
        <TriStateToggle
          label={copy.settings.likedByMe}
          icon={ThumbsUp}
          state={settings.filters.likedByMe}
          onCycle={() => cycleTriState('likedByMe')}
        />
        <TriStateToggle
          label={copy.settings.dislikedByMe}
          icon={ThumbsDown}
          state={settings.filters.dislikedByMe}
          onCycle={() => cycleTriState('dislikedByMe')}
        />
        <TriStateToggle
          label={copy.settings.reportedByMe}
          icon={Flag}
          state={settings.filters.reportedByMe}
          onCycle={() => cycleTriState('reportedByMe')}
        />
      </div>

      <!-- Media type filters -->
      <div class="flex items-center gap-1">
        {#each TYPE_OPTIONS as option (option.type)}
          {@const selected = settings.filters.types.has(option.type)}
          {@const Icon = option.icon}
          <Tooltip text={option.label} side="bottom">
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={selected}
              class={cn(
                'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
                shakingType === option.type
                  ? 'shake-feedback bg-destructive text-white'
                  : selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
              )}
              onanimationend={() => finishTypeFeedback(option.type)}
              onclick={() => toggleType(option.type)}
            >
              <Icon class="size-4" />
            </button>
          </Tooltip>
        {/each}
      </div>
    </div>
  </section>

  <!-- Interface section. The layout sliders must not be hidden while one of them is dragged,
       so the transparency is carried by the chrome around them — the header and the mode row. -->
  <section>
    <div
      class="flex items-center justify-between px-1 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {previewing
        ? 'opacity-0'
        : 'opacity-100'}"
    >
      <h3 class="flex items-center gap-1.5 text-sm font-medium">
        <LayoutGrid class="size-3.5" />{copy.settings.interfaceSection}
      </h3>
      <Tooltip text={copy.settings.resetLayout} side="bottom">
        <button
          aria-label={copy.settings.resetLayout}
          type="button"
          class="icon-button size-7"
          onclick={resetLayout}
        >
          <RotateCcw class="size-3.5" />
        </button>
      </Tooltip>
    </div>

    <div
      class="mt-4 flex items-center gap-2 px-1 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {previewing
        ? 'opacity-0'
        : 'opacity-100'}"
    >
      <!-- Language, arrangement, then scroll direction. The extra gap separates language from layout. -->
      <div class="mr-1">
        <LocaleToggle onChange={onLocaleChange} />
      </div>
      <Tooltip
        text={settings.layout.strategy === 'shortest'
          ? copy.settings.switchToEqualHeight
          : copy.settings.switchToEqualWidth}
        side="bottom"
      >
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-secondary/80"
          aria-label={settings.layout.strategy === 'shortest'
            ? copy.settings.switchToEqualHeight
            : copy.settings.switchToEqualWidth}
          aria-pressed={settings.layout.strategy === 'sequential'}
          onclick={toggleStrategy}
        >
          {#if settings.layout.strategy === 'shortest'}
            <Columns3 class="size-4" />
          {:else}
            <Rows3 class="size-4" />
          {/if}
        </button>
      </Tooltip>
      <Tooltip
        text={settings.layout.dir === 'v'
          ? copy.settings.switchToHorizontal
          : copy.settings.switchToVertical}
        side="bottom"
      >
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-secondary/80"
          aria-label={settings.layout.dir === 'v'
            ? copy.settings.switchToHorizontal
            : copy.settings.switchToVertical}
          aria-pressed={settings.layout.dir === 'h'}
          onclick={toggleDir}
        >
          {#if settings.layout.dir === 'v'}
            <ArrowDownToLine class="size-4" />
          {:else}
            <ArrowRightToLine class="size-4" />
          {/if}
        </button>
      </Tooltip>
    </div>

    <!-- Target band width and gap: single-thumb sliders. Only the slider under the pointer
         stays visible; the other goes fully transparent while the waterfall reflows. -->
    <div class="mt-4 space-y-3.5 px-1">
      <div
        class="transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {previewing &&
        previewing !== 'band'
          ? 'opacity-0'
          : 'opacity-100'}"
      >
        <SingleSlider
          min={MIN_BAND}
          max={MAX_BAND}
          step={10}
          value={settings.layout.band}
          defaultValue={LAYOUT_DEFAULTS.band}
          icon={Ruler}
          format={(v) => `${v}px`}
          onChange={setBand}
          onDragChange={(dragging) => (previewing = dragging ? 'band' : null)}
        />
      </div>
      <div
        class="transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {previewing &&
        previewing !== 'gap'
          ? 'opacity-0'
          : 'opacity-100'}"
      >
        <SingleSlider
          min={0}
          max={32}
          step={1}
          value={settings.layout.gap}
          defaultValue={LAYOUT_DEFAULTS.gap}
          icon={MoveHorizontal}
          format={(v) => `${v}px`}
          onChange={setGap}
          onDragChange={(dragging) => (previewing = dragging ? 'gap' : null)}
        />
      </div>
    </div>
  </section>
</div>
