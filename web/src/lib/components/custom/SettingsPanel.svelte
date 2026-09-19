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
    RotateCcw,
    ChevronDown,
  } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import type { ScrollDir, FillStrategy } from "$base/lib/layout";
  import type { Photo } from "$shared/types";
  import {
    defaultSettings,
    defaultFilterSettings,
    countActiveFilters,
    isFilterable,
    metricRange,
    RANGE_KEYS,
    RANGE_LABELS,
    type RangeKey,
    type Settings,
  } from "../../../settings";
  import { humanSize } from "$base/lib/format";
  import TriStateToggle from "./TriStateToggle.svelte";
  import RangeSlider from "./RangeSlider.svelte";

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
      if (raw) {
        const parsed = JSON.parse(raw) as {
          filters: { types: number[] } & Omit<Settings["filters"], "types">;
          layout: Settings["layout"];
          filtersOpen: boolean;
          layoutOpen: boolean;
        };
        return {
          ...parsed,
          filters: { ...parsed.filters, types: new Set(parsed.filters.types) },
        };
      }
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

  /** 「范围」子组是否完全无可筛项（元数据为空，或五项均 min = max）。 */
  let noFilterableRange = $derived(
    photos.length === 0 || RANGE_KEYS.every((k) => !isFilterable(photos, k)),
  );

  /** 某项的当前区间：已启用取用户值，否则取完整动态范围。 */
  function rangeValue(key: RangeKey): [number, number] {
    const full = metricRange(photos, key) ?? [0, 0];
    return settings.filters.ranges[key] ?? full;
  }

  /** 已启用但等于完整范围 → 视为未生效（标签回落 muted、隐藏重置）。 */
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

  function resetRange(key: RangeKey) {
    const next = { ...settings.filters.ranges };
    delete next[key];
    settings = { ...settings, filters: { ...settings.filters, ranges: next } };
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

  function resetAll() {
    settings = defaultSettings();
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
</script>

<div class="space-y-1">
  <!-- Filters section -->
  <details
    open={settings.filtersOpen}
    ontoggle={(e) =>
      (settings = {
        ...settings,
        filtersOpen: (e.target as HTMLDetailsElement).open,
      })}
  >
    <summary
      class="flex cursor-pointer items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-muted rounded-md transition-colors select-none list-none [&::-webkit-details-marker]:hidden"
    >
      <span class="flex items-center gap-2">
        筛选
        {#if activeFilterCount > 0}
          <span
            class="flex items-center justify-center size-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
          >
            {activeFilterCount}
          </span>
        {/if}
      </span>
      <ChevronDown
        class="size-4 text-muted-foreground transition-transform details-open:rotate-180"
      />
    </summary>
    <div class="space-y-4 px-1 pt-2 pb-2">
      <!-- 范围：五项双柄滑块；无照片或全项 min = max 时标题下显示占位文字 -->
      <div class="space-y-3">
        <span class="text-xs font-medium text-foreground">范围</span>
        {#if noFilterableRange}
          <p class="text-xs text-muted-foreground">上传照片后可按数值筛选</p>
        {:else}
          {#each RANGE_KEYS as key (key)}
            {@const full = metricRange(photos, key)}
            {@const filterable = isFilterable(photos, key)}
            {#if full}
              <div>
                <span class="mb-1 block text-xs text-muted-foreground"
                  >{RANGE_LABELS[key]}</span
                >
                <RangeSlider
                  min={full[0]}
                  max={full[1]}
                  value={rangeValue(key)}
                  active={rangeActive(key)}
                  disabled={!filterable}
                  format={key === "size" ? humanSize : (v) => String(v)}
                  onChange={(v) => setRange(key, v)}
                  onReset={() => resetRange(key)}
                />
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
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
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
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
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
            "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
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
  </details>

  <!-- Layout section -->
  <details
    open={settings.layoutOpen}
    ontoggle={(e) =>
      (settings = {
        ...settings,
        layoutOpen: (e.target as HTMLDetailsElement).open,
      })}
  >
    <summary
      class="flex cursor-pointer items-center justify-between px-2 py-1.5 text-sm font-medium hover:bg-muted rounded-md transition-colors select-none list-none [&::-webkit-details-marker]:hidden"
    >
      布局
      <ChevronDown
        class="size-4 text-muted-foreground transition-transform details-open:rotate-180"
      />
    </summary>
    <div class="space-y-4 px-1 pt-2 pb-2">
      <!-- Scroll direction -->
      <div class="space-y-1.5">
        <span class="text-xs text-muted-foreground">滚动方向</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors h-9 w-9",
              settings.layout.dir === "v"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onclick={() => setDir("v")}
            title="纵向"
          >
            <ArrowDownToLine class="size-4" />
          </button>
          <button
            type="button"
            class={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors h-9 w-9",
              settings.layout.dir === "h"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onclick={() => setDir("h")}
            title="横向"
          >
            <ArrowRightToLine class="size-4" />
          </button>
        </div>
      </div>

      <!-- Fill strategy -->
      <div class="space-y-1.5">
        <span class="text-xs text-muted-foreground">填充策略</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors h-9 w-9",
              settings.layout.strategy === "sequential"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onclick={() => setStrategy("sequential")}
            title="Sequential"
          >
            <ListOrdered class="size-4" />
          </button>
          <button
            type="button"
            class={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors h-9 w-9",
              settings.layout.strategy === "shortest"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            )}
            onclick={() => setStrategy("shortest")}
            title="Shortest"
          >
            <AlignHorizontalDistributeCenter class="size-4" />
          </button>
        </div>
      </div>

      <!-- Band width -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="layout-band" class="text-xs text-muted-foreground"
            >目标带宽</label
          >
          <span class="text-xs text-muted-foreground"
            >{settings.layout.band}px</span
          >
        </div>
        <input
          id="layout-band"
          type="range"
          min="200"
          max="800"
          step="10"
          value={settings.layout.band}
          oninput={(e) => setBand(Number((e.target as HTMLInputElement).value))}
          class="w-full h-2 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
        />
      </div>

      <!-- Gap -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="layout-gap" class="text-xs text-muted-foreground"
            >间距</label
          >
          <span class="text-xs text-muted-foreground"
            >{settings.layout.gap}px</span
          >
        </div>
        <input
          id="layout-gap"
          type="range"
          min="0"
          max="32"
          step="1"
          value={settings.layout.gap}
          oninput={(e) => setGap(Number((e.target as HTMLInputElement).value))}
          class="w-full h-2 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
        />
      </div>
    </div>
  </details>

  <!-- Reset -->
  <div class="px-1 pt-1">
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full"
      onclick={resetAll}
    >
      <RotateCcw class="size-4 mr-2" />
      重置
    </button>
  </div>
</div>
