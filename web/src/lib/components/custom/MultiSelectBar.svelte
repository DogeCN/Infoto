<script lang="ts">
  // Fixed full-width bottom bar for multi-select with a blurred surface and
  // transform slide in/out. Left: select-all plus the count; right: download,
  // total size, and the other actions. Exiting multi-select only happens via
  // the top-bar icon (no deselect button here).
  import { CheckSquare, Square, Download, Trash2, Undo2 } from "@lucide/svelte";
  import type { Photo } from "$shared/types";
  import { humanSize } from "$base/lib/format";
  import Tooltip from "./Tooltip.svelte";

  interface Props {
    selected: Set<number>;
    photos: Photo[];
    selfId?: number;
    visible: boolean;
    onSelectAll?: () => void;
    onDeselectAll?: () => void;
    onDownload?: () => void;
    onUnmark?: () => void;
    onDelete?: () => void;
  }

  let {
    selected,
    photos,
    selfId = -1,
    visible,
    onSelectAll,
    onDeselectAll,
    onDownload,
    onUnmark,
    onDelete,
  }: Props = $props();

  let count = $derived(selected.size);
  let totalSize = $derived(
    photos
      .filter((p) => selected.has(p.id))
      .reduce((sum, p) => sum + (p.size || 0), 0),
  );
  let allSelected = $derived(count === photos.length && photos.length > 0);

  /** Whether the current user has any mark on the selection (unmark enable). */
  let hasAnyMark = $derived(
    photos.some(
      (p) =>
        selected.has(p.id) &&
        (p.likes.includes(selfId) ||
          p.dislikes.includes(selfId) ||
          p.reports.includes(selfId)),
    ),
  );

  const btn =
    "inline-flex size-10 items-center justify-center rounded-full transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10";
</script>

<div
  class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
  style="transform: translateY({visible ? '0' : '110%'}); visibility: {visible
    ? 'visible'
    : 'hidden'}; transition: transform var(--duration-spring) var(--ease-spring), visibility 0s"
>
  <!-- Select / deselect all plus the count -->
  <div class="flex items-center gap-1.5">
    <Tooltip text={allSelected ? "取消全选" : "全选"} side="bottom">
      <button
        type="button"
        class="{btn} {allSelected ? 'text-primary' : 'text-muted-foreground'}"
        onclick={allSelected ? onDeselectAll : onSelectAll}
      >
        {#if allSelected}
          <CheckSquare class="size-5" />
        {:else}
          <Square class="size-5" />
        {/if}
      </button>
    </Tooltip>
    {#if count > 0}
      <span
        class="min-w-5 text-center text-sm font-medium tabular-nums text-foreground"
      >
        {count}
      </span>
    {/if}
  </div>

  <!-- Download (with total size) / unmark / delete (root) -->
  <div class="flex items-center gap-1">
    <Tooltip text="下载" side="bottom">
      <button
        type="button"
        class="{btn} text-success hover:bg-success/10 disabled:opacity-40"
        onclick={onDownload}
        disabled={count === 0}
      >
        <Download class="size-5" />
      </button>
    </Tooltip>
    {#if count > 0}
      <span class="-ml-1 mr-1 text-xs tabular-nums text-muted-foreground">
        {humanSize(totalSize)}
      </span>
    {/if}

    <Tooltip text="取消标记" side="bottom">
      <button
        type="button"
        class="{btn} text-muted-foreground hover:text-foreground disabled:opacity-40"
        class:text-warning={hasAnyMark}
        onclick={onUnmark}
        disabled={!hasAnyMark}
      >
        <Undo2 class="size-5" />
      </button>
    </Tooltip>

    {#if selfId === 0}
      <Tooltip text="删除" side="bottom">
        <button
          type="button"
          class="{btn} text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onclick={onDelete}
          disabled={count === 0}
        >
          <Trash2 class="size-5" />
        </button>
      </Tooltip>
    {/if}
  </div>
</div>
