<script lang="ts">
  // Multi-select bottom bar (spec: "multi-select mode" / "custom component list"). Full-width fixed
  // bar + frosted glass, sliding in/out via transform. Select-all + count left, download + total
  // size + other actions right. Exit only via the top-bar icon (the bar's "deselect" button was cut).
  import { CheckSquare, Square, Download, Trash2, Undo2 } from '@lucide/svelte';
  import type { Photo } from '$shared/types';
  import { humanSize } from '$base/lib/format';

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
    photos.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (p.size || 0), 0),
  );
  let allSelected = $derived(count === photos.length && photos.length > 0);

  /** Whether any selected item carries the current user's mark (otherwise the unmark button is greyed out). */
  let hasAnyMark = $derived(
    photos.some(
      (p) =>
        selected.has(p.id) &&
        (p.likes.includes(selfId) || p.dislikes.includes(selfId) || p.reports.includes(selfId)),
    ),
  );

  const btn =
    'inline-flex size-10 items-center justify-center rounded-full transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10';
</script>

<div
  class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
  style="transform: translateY({visible ? '0' : '110%'}); visibility: {visible
    ? 'visible'
    : 'hidden'}; transition: transform var(--duration-spring) var(--ease-spring), visibility 0s"
>
  <!-- Select all / clear selection + selected count -->
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="{btn} {allSelected ? 'text-primary' : 'text-muted-foreground'}"
      onclick={allSelected ? onDeselectAll : onSelectAll}
      title={allSelected ? '取消全选' : '全选'}
    >
      {#if allSelected}
        <CheckSquare class="size-5" />
      {:else}
        <Square class="size-5" />
      {/if}
    </button>
    {#if count > 0}
      <span class="min-w-5 text-center text-sm font-medium tabular-nums text-foreground">
        {count}
      </span>
    {/if}
  </div>

  <!-- Download (with total size) / unmark / delete (root user) -->
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="{btn} text-success hover:bg-success/10 disabled:opacity-40"
      onclick={onDownload}
      disabled={count === 0}
      title="下载"
    >
      <Download class="size-5" />
    </button>
    {#if count > 0}
      <span class="-ml-1 mr-1 text-xs tabular-nums text-muted-foreground">
        {humanSize(totalSize)}
      </span>
    {/if}

    <button
      type="button"
      class="{btn} text-muted-foreground hover:text-foreground disabled:opacity-40"
      class:text-warning={hasAnyMark}
      onclick={onUnmark}
      disabled={!hasAnyMark}
      title="取消标记"
    >
      <Undo2 class="size-5" />
    </button>

    {#if selfId === 0}
      <button
        type="button"
        class="{btn} text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onclick={onDelete}
        disabled={count === 0}
        title="删除"
      >
        <Trash2 class="size-5" />
      </button>
    {/if}
  </div>
</div>
