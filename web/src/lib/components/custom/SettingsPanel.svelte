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
    Flame,
    HardDrive,
  } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import type { ScrollDir, FillStrategy } from "$base/lib/layout";
  import type { Component } from "svelte";
  import type { Photo } from "$shared/types";
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

  interface Props {
    onSettingsChange?: (settings: Settings) => void;
    /** 用于计算各范围筛选的动态可调范围。 */
    photos?: Photo[];
    onFilterCount?: (count: number) => void;
    /** 递增即触发一次「重置全部筛选」，供顶栏角标调用。 */
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

  $effect(() => {
    saveSettings(settings);
    onSettingsChange?.(settings);
  });

  let activeFilterCount = $derived(countActiveFilters(settings.filters));

  /** 布局参数的出厂默认值（用于判断「是否非默认」→ 图标/数值高亮）。 */
  const LAYOUT_DEFAULTS = defaultSettings().layout;

  /** 范围子组是否完全无可筛项（元数据为空，或五项均 min = max）。 */
  let noFilterableRange = $derived(
    photos.length === 0 || RANGE_KEYS.every((k) => !isFilterable(photos, k)),
  );

  /** 范围筛选行的左侧图标（热度/喜欢/不喜欢/请求删除/文件大小）。 */
  const RANGE_ICONS: Record<RangeKey, Component> = {
    heat: Flame,
    likes: ThumbsUp,
    dislikes: ThumbsDown,
    reports: Flag,
    size: HardDrive,
  };

  /** 某项的当前区间：已启用取用户值，否则取完整动态范围。 */
  function rangeValue(key: RangeKey): [number, number] {
    const full = metricRange(photos, key) ?? [0, 0];
    return settings.filters.ranges[key] ?? full;
  }

  /** 已启用但等于完整范围 → 视为未生效（图标与数值回落 muted）。 */
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

  // 生效筛选数上报（顶栏设置图标的计数角标）
  $effect(() => {
    onFilterCount?.(activeFilterCount);
  });

  // 顶栏角标点击 → 重置全部筛选
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

  function toggleType(t: number) {
    const next = new Set(settings.filters.types);
    if (next.has(t)) {
      if (next.size > 1) next.delete(t);
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

  /** 分区标题行：左侧标题、右侧该分区重置按钮。 */
</script>

<!-- pb-4：滚动容器不再提供底部 padding（见 OverlaySidebar），底部留白由面板自理 -->
<div class="space-y-6 pb-4">
  <!-- Filters section（平铺） -->
  <section>
    <div class="flex items-center justify-between px-1">
      <h3 class="text-sm font-medium">筛选</h3>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground"
        title="重置筛选"
        onclick={resetFilters}
      >
        <RotateCcw class="size-3.5" />
      </button>
    </div>

    <div class="mt-4 space-y-5 px-1">
      <!-- 范围：行式「图标 下限值【双柄滑块】上限值」 -->
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
                    : 'text-muted-foreground'} {filterable
                    ? ''
                    : 'opacity-50'}"
                />
                <div class="min-w-0 flex-1">
                  <RangeSlider
                    min={full[0]}
                    max={full[1]}
                    value={rangeValue(key)}
                    {active}
                    disabled={!filterable}
                    format={key === "size" ? compactSize : (v) => String(v)}
                    onChange={(v) => setRange(key, v)}
                  />
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      <!-- 归属：四枚三态开关 -->
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

      <!-- 类型：三枚开关，至少保留一个 -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.filters.types.has(0)
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => toggleType(0)}
        >
          <Image class="size-4" />
        </button>
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.filters.types.has(1)
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => toggleType(1)}
        >
          <ImagePlay class="size-4" />
        </button>
        <button
          type="button"
          class={cn(
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
            settings.filters.types.has(2)
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
          onclick={() => toggleType(2)}
        >
          <Video class="size-4" />
        </button>
      </div>
    </div>
  </section>

  <!-- Layout section（平铺） -->
  <section>
    <div class="flex items-center justify-between px-1">
      <h3 class="text-sm font-medium">布局</h3>
      <button
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted hover:text-foreground"
        title="重置布局"
        onclick={resetLayout}
      >
        <RotateCcw class="size-3.5" />
      </button>
    </div>

    <div class="mt-4 space-y-3.5 px-1">
      <!-- 滚动方向 + 填充策略：与归属开关同款的图标文字按钮 -->
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

      <!-- 目标带宽 / 间距：与范围筛选同款的行式滑块（单柄版） -->
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
