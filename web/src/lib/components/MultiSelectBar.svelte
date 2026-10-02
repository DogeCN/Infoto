<script lang="ts">
  // Multi-select bottom bar: full-width fixed bar + frosted glass, sliding in/out via
  // transform. Select-all + count left, download + total size + other actions right.
  // Exit only via the top-bar icon.
  import { CheckSquare, Square, Download, Trash2, Undo2 } from '@lucide/svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
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

  // Exclude optimistic uploads from selectable counts and download sizes.
  let selectable = $derived(photos.filter((p) => p.id >= 0));
  let count = $derived(selected.size);
  let totalSize = $derived(
    selectable.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (p.size || 0), 0),
  );
  let allSelected = $derived(count === selectable.length && selectable.length > 0);

  /** Whether selected photos contain a mark the current user can remove. */
  let hasAnyMark = $derived(
    selectable.some(
      (p) =>
        selected.has(p.id) &&
        (p.likes.includes(selfId) || p.dislikes.includes(selfId) || p.reports.includes(selfId)),
    ),
  );

  const btn =
    'inline-flex items-center justify-center rounded-full transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10';
</script>

<div
  class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 shadow-lift"
  style="transform: translateY({visible ? '0' : '110%'}); visibility: {visible
    ? 'visible'
    : 'hidden'}; transition: transform var(--duration-spring) var(--ease-spring), visibility 0s"
>
  <!-- Select all / clear selection + selected count -->
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="{btn} size-10 {allSelected ? 'text-primary' : 'text-muted-foreground'}"
      onclick={allSelected ? onDeselectAll : onSelectAll}
      title={allSelected ? copy.multiSelect.deselectAll : copy.multiSelect.selectAll}
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
      class="{btn} h-10 text-success hover:bg-success/10 {count > 0 ? 'gap-1 px-2.5' : 'size-10'}"
      onclick={onDownload}
      disabled={count === 0}
      title={copy.multiSelect.download}
    >
      <Download class="size-5" />
      {#if count > 0}
        <span class="text-xs tabular-nums text-muted-foreground">{humanSize(totalSize)}</span>
      {/if}
    </button>

    <!-- Download and delete require a selection; unmark requires an existing user mark. -->
    <button
      type="button"
      class="{btn} size-10 text-warning hover:bg-warning/10"
      onclick={onUnmark}
      disabled={!hasAnyMark}
      title={copy.multiSelect.unmark}
    >
      <Undo2 class="size-5" />
    </button>

    {#if selfId === 0}
      <button
        type="button"
        class="{btn} size-10 text-destructive hover:bg-destructive/10"
        onclick={onDelete}
        disabled={count === 0}
        title={copy.multiSelect.delete}
      >
        <Trash2 class="size-5" />
      </button>
    {/if}
  </div>
</div>
