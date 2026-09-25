<script lang="ts">
  // Sort pills: segmented three-way selector (latest / hottest / random).
  // The active item's icon and text reflect its per-key direction; narrow
  // widths drop the text and keep the icons (no DropdownMenu fallback).
  // A sliding indicator pill animates across the selector on change.
  import {
    ArrowDownWideNarrow,
    ArrowUpWideNarrow,
    Flame,
    Snowflake,
    Shuffle,
  } from "@lucide/svelte";
  import { cn } from "$lib/utils";
  import Tooltip from "./Tooltip.svelte";

  export type SortKey = "latest" | "hottest" | "random";

  interface Props {
    sortKey?: SortKey;
    /**
     * Per-key remembered directions. All three must be passed: an inactive
     * item without its own direction would snap to the default text the
     * moment it is deselected (a visible flicker on the next selection).
     */
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
  }

  let {
    sortKey = "latest",
    dirs = {},
    onChange,
    onReshuffle,
  }: Props = $props();

  const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: "latest", label: "最新" },
    { key: "hottest", label: "最热" },
    { key: "random", label: "随机" },
  ];

  function iconFor(key: SortKey, asc: boolean) {
    if (key === "latest") return asc ? ArrowUpWideNarrow : ArrowDownWideNarrow;
    if (key === "hottest") return asc ? Snowflake : Flame;
    return Shuffle;
  }

  function labelFor(key: SortKey, asc: boolean): string {
    if (key === "latest") return asc ? "最旧" : "最新";
    if (key === "hottest") return asc ? "最冷" : "最热";
    return "随机";
  }

  function pick(key: SortKey) {
    // Random reshuffles on every click.
    if (key === "random" && key === sortKey) {
      onReshuffle?.();
      return;
    }
    onChange?.(key);
  }

  // Sliding indicator tracks button geometry. Actions record the buttons,
  // since bind:this onto a plain object warns binding_property_non_reactive.
  const btnEls: Partial<Record<SortKey, HTMLButtonElement>> = {};
  let indicator = $state({ x: 0, w: 0, ready: true });

  function track(el: HTMLButtonElement, key: SortKey) {
    btnEls[key] = el;
    syncIndicator(key);
    return {
      destroy() {
        delete btnEls[key];
      },
    };
  }

  function syncIndicator(key: SortKey) {
    const el = btnEls[key];
    if (el) indicator = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }

  $effect(() => {
    // sortKey dependency: slide to the active item.
    syncIndicator(sortKey);
  });

  // Hiding text at breakpoints changes button widths; recompute on resize.
  $effect(() => {
    const onResize = () => syncIndicator(sortKey);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
</script>

<div
  class="relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1"
>
  <!-- Sliding indicator pill -->
  <div
    class="pointer-events-none absolute bottom-1 top-1 rounded-full bg-primary transition-[transform,width,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:opacity-0={!indicator.ready}
    style="width: {indicator.w}px; transform: translateX({indicator.x}px)"
  ></div>
  {#each SORTS as s (s.key)}
    {@const active = s.key === sortKey}
    {@const asc = dirs[s.key] ?? false}
    {@const Icon = iconFor(s.key, asc)}
    {@const label = labelFor(s.key, asc)}
    <Tooltip text={label}>
      <button
        use:track={s.key}
        type="button"
        class={cn(
          "relative z-10 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]",
          active
            ? "text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        onclick={() => pick(s.key)}
      >
        <Icon class="size-4" />
        <span class="hidden sm:inline">{label}</span>
      </button>
    </Tooltip>
  {/each}
</div>
