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
    ListOrdered,
    AlignHorizontalDistributeCenter,
    MoveHorizontal,
    UnfoldHorizontal,
    RotateCcw,
    X,
    Flame,
    HardDrive,
  } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import type { ScrollDir, FillStrategy } from "$base/lib/layout";
  import type { Component } from "svelte";
  import type { MediaType, Photo } from "$shared/types";
  import {
    defaultSettings,
    defaultFilterSettings,
    normalizeSettings,
    countActiveFilters,
    isFilterable,
    metricRange,
    RANGE_KEYS,
    type RangeKey,
    type Settings,
  } from "../../../settings";
  import { compactSize } from "$base/lib/format";
  import TriStateToggle from "./TriStateToggle.svelte";
  import RangeSlider from "./RangeSlider.svelte";
  import SingleSlider from "./SingleSlider.svelte";
  import Tooltip from "./Tooltip.svelte";

  interface Props {
    onSettingsChange?: (settings: Settings) => void;
    /** Source photos for computing dynamic ranges. */
    photos?: Photo[];
    onFilterCount?: (count: number) => void;
    /** Increment to trigger "reset all filters" (top-bar badge). */
    resetToken?: number;
  }

  const STORAGE_KEY = "infoto-settings";

  function loadSettings(): Settings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeSettings(JSON.parse(raw));
    } catch {}
    return defaultSettings();
  }

  function saveSettings(s: Settings) {
    const toSave = {
      ...s,
      filters: { ...s.filters, types: Array.from(s.filters.types) },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }

  let {
    onSettingsChange,
    photos = [],
    onFilterCount,
    resetToken = 0,
  }: Props = $props();
  let settings = $state<Settings>(loadSettings());

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
  const LAYOUT_DEFAULTS = defaultSettings().layout;

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

  /** Clear one range back to the full dynamic range. */
  function clearRange(key: RangeKey) {
    const ranges = { ...settings.filters.ranges };
    delete ranges[key];
    settings = { ...settings, filters: { ...settings.filters, ranges } };
  }

  // Report the active filter count (settings-icon badge).
  $effect(() => {
    onFilterCount?.(activeFilterCount);
  });

  // Top-bar badge click: reset all filters.
  let lastReset = $state(0);
  $effect(() => {
    if (resetToken !== lastReset) {
      lastReset = resetToken;
      settings = { ...settings, filters: defaultFilterSettings() };
    }
  });

  function resetFilters() {
    settings = { ...settings, filters: defaultFilterSettings() };
  }

  function resetLayout() {
    settings = { ...settings, layout: defaultSettings().layout };
  }

  let shakingType = $state<MediaType | null>(null);
  const TYPE_LABELS: Record<number, string> = {
    0: "图片",
    1: "动图",
    2: "视频",
  };

  /** Type button hint; the sole remaining type explains it cannot be removed. */
  function typeTip(t: MediaType): string {
    return settings.filters.types.size === 1 && settings.filters.types.has(t)
      ? "至少保留一个类型"
      : TYPE_LABELS[t]!;
  }

  function toggleType(t: MediaType) {
    const next = new Set(settings.filters.types);
    if (next.has(t)) {
      if (next.size === 1) {
        // The last type stays: shake the button and flash the destructive color.
        shakingType = t;
        return;
      }
      next.delete(t);
    } else {
      next.add(t);
    }
    settings = { ...settings, filters: { ...settings.filters, types: next } };
  }

  function cycleTriState(
    field: "ownedByMe" | "likedByMe" | "dislikedByMe" | "reportedByMe",
  ) {
    const cur = settings.filters[field];
    settings = {
      ...settings,
      filters: {
        ...settings.filters,
        [field]: cur === "off" ? "only" : cur === "only" ? "exclude" : "off",
      },
    };
  }

  function setDir(d: ScrollDir) {
    settings = { ...settings, layout: { ...settings.layout, dir: d } };
  }
  function setStrategy(s: FillStrategy) {
    settings = { ...settings, layout: { ...settings.layout, strategy: s } };
  }
  function setBand(v: number) {
    settings = { ...settings, layout: { ...settings.layout, band: v } };
  }
  function setGap(v: number) {
    settings = { ...settings, layout: { ...settings.layout, gap: v } };
  }

  export function getSettings(): Settings {
    return settings;
  }

  /** Section title row with the per-section reset control. */
</script>

<!-- pb-4: the scroll container has no bottom padding (see OverlaySidebar) -->
<div class="space-y-6 pb-4">
  <!-- Filters section -->
  <section>
    <div class="flex items-center justify-between px-1">
      <h3 class="text-sm font-medium">筛选</h3>
      <Tooltip text="重置筛选" side="bottom">
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground"
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
          <p class="text-xs text-muted-foreground">上传照片后可按数值筛选</p>
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
                    scale={key === "size" ? "log" : "linear"}
                    {active}
                    disabled={!filterable}
                    format={key === "size" ? compactSize : (v) => String(v)}
                    onChange={(v) => setRange(key, v)}
                  />
                </div>
                {#if active}
                  <Tooltip text="重置此项" side="bottom">
                    <button
                      type="button"
                      class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onclick={() => clearRange(key)}
                      aria-label="重置此项"
                    >
                      <X class="size-3.5" />
                    </button>
                  </Tooltip>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      <!-- Ownership: four tri-state toggles -->
      <div class="grid grid-cols-2 gap-2">
        <TriStateToggle
          label="我上传的"
          icon={Upload}
          state={settings.filters.ownedByMe}
          onCycle={() => cycleTriState("ownedByMe")}
        />
        <TriStateToggle
          label="我喜欢的"
          icon={ThumbsUp}
          state={settings.filters.likedByMe}
          onCycle={() => cycleTriState("likedByMe")}
        />
        <TriStateToggle
          label="我不喜欢的"
          icon={ThumbsDown}
          state={settings.filters.dislikedByMe}
          onCycle={() => cycleTriState("dislikedByMe")}
        />
        <TriStateToggle
          label="我请求删除的"
          icon={Flag}
          state={settings.filters.reportedByMe}
          onCycle={() => cycleTriState("reportedByMe")}
        />
      </div>

      <!-- Types: three toggles, at least one remains -->
      <div class="flex items-center gap-1">
        <Tooltip text={typeTip(0)} side="bottom">
          <button
            type="button"
            class={cn(
              "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
              shakingType === 0
                ? "bg-destructive text-white"
                : settings.filters.types.has(0)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            style={shakingType === 0 ? "animation: shakeX 200ms both" : ""}
            onanimationend={() => shakingType === 0 && (shakingType = null)}
            onclick={() => toggleType(0)}
          >
            <Image class="size-4" />
          </button>
        </Tooltip>
        <Tooltip text={typeTip(1)} side="bottom">
          <button
            type="button"
            class={cn(
              "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
              shakingType === 1
                ? "bg-destructive text-white"
                : settings.filters.types.has(1)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            style={shakingType === 1 ? "animation: shakeX 200ms both" : ""}
            onanimationend={() => shakingType === 1 && (shakingType = null)}
            onclick={() => toggleType(1)}
          >
            <ImagePlay class="size-4" />
          </button>
        </Tooltip>
        <Tooltip text={typeTip(2)} side="bottom">
          <button
            type="button"
            class={cn(
              "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
              shakingType === 2
                ? "bg-destructive text-white"
                : settings.filters.types.has(2)
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            style={shakingType === 2 ? "animation: shakeX 200ms both" : ""}
            onanimationend={() => shakingType === 2 && (shakingType = null)}
            onclick={() => toggleType(2)}
          >
            <Video class="size-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  </section>

  <!-- Layout section -->
  <section>
    <div class="flex items-center justify-between px-1">
      <h3 class="text-sm font-medium">布局</h3>
      <Tooltip text="重置布局" side="bottom">
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground"
          onclick={resetLayout}
        >
          <RotateCcw class="size-3.5" />
        </button>
      </Tooltip>
    </div>

    <div class="mt-4 space-y-3.5 px-1">
      <!-- Scroll direction and fill strategy: icon buttons -->
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.layout.dir === "v"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => setDir("v")}
        >
          <ArrowDownToLine class="size-3.5" />
          <span class="truncate">纵向</span>
        </button>
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.layout.dir === "h"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => setDir("h")}
        >
          <ArrowRightToLine class="size-3.5" />
          <span class="truncate">横向</span>
        </button>
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.layout.strategy === "sequential"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => setStrategy("sequential")}
        >
          <ListOrdered class="size-3.5" />
          <span class="truncate">顺序</span>
        </button>
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.layout.strategy === "shortest"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => setStrategy("shortest")}
        >
          <AlignHorizontalDistributeCenter class="size-3.5" />
          <span class="truncate">最短</span>
        </button>
      </div>

      <!-- Band and gap: single-thumb sliders -->
      <SingleSlider
        min={200}
        max={800}
        step={10}
        value={settings.layout.band}
        defaultValue={LAYOUT_DEFAULTS.band}
        icon={UnfoldHorizontal}
        format={(v) => `${v}px`}
        onChange={setBand}
      />
      <SingleSlider
        min={0}
        max={32}
        step={1}
        value={settings.layout.gap}
        defaultValue={LAYOUT_DEFAULTS.gap}
        icon={MoveHorizontal}
        format={(v) => `${v}px`}
        onChange={setGap}
      />
    </div>
  </section>
</div>
