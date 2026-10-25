<script lang="ts">
  // Multi-select bottom bar: full-width fixed bar + frosted glass, sliding in/out via
  // transform. Select-all + count left, download + total size + other actions right.
  // Exit only via the top-bar icon.
  import { CheckSquare, Square, Download, Trash2, Undo2 } from '@lucide/svelte';
  import type { Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { humanSize } from '$base/lib/format';
  import TooltipIconButton from './TooltipIconButton.svelte';

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

  // Every card is selectable — a pending upload has to be, or a stuck one cannot be batch-deleted.
  // Only hosted photos contribute a size and a download, because a pending card's URL is a local
  // preview with no hosted file behind it yet.
  let selectable = $derived(photos.filter((p) => p.id >= 0));
  let count = $derived(selected.size);
  let totalSize = $derived(
    selectable.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (p.size || 0), 0),
  );
  // The control means "every card on screen is selected", so it compares against all cards, not
  // against the hosted-only set its size math uses; crossing the two sets made it read "not all
  // selected" whenever an upload was on screen, and click again re-selected instead of clearing.
  let allSelected = $derived(count > 0 && count === photos.length);

  /** Whether selected photos contain a mark the current user can remove. */
  let hasAnyMark = $derived(
    selectable.some(
      (p) =>
        selected.has(p.id) &&
        (p.likes.includes(selfId) || p.dislikes.includes(selfId) || p.reports.includes(selfId)),
    ),
  );
</script>

<div
  class="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-popover/95 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 shadow-lift {visible
    ? ''
    : 'pointer-events-none'}"
  inert={!visible}
  style="transform: translateY({visible
    ? '0'
    : '110%'}); transition: transform var(--duration-spring) var(--ease-spring)"
>
  <!-- Select all / clear selection + selected count -->
  <div class="flex items-center gap-1.5">
    <TooltipIconButton
      text={allSelected ? copy.multiSelect.deselectAll : copy.multiSelect.selectAll}
      side="top"
      active={allSelected}
      class="size-10 {allSelected ? 'text-primary' : 'text-muted-foreground'}"
      onclick={allSelected ? onDeselectAll : onSelectAll}
    >
      {#if allSelected}
        <CheckSquare class="size-5" />
      {:else}
        <Square class="size-5" />
      {/if}
    </TooltipIconButton>
    {#if count > 0}
      <span class="min-w-5 text-center text-sm font-medium tabular-nums text-foreground">
        {count}
      </span>
    {/if}
  </div>

  <!-- Download (with total size) / unmark / delete (root user) -->
  <div class="flex items-center gap-1">
    <!-- Download and delete require a selection; unmark requires an existing user mark. -->
    <TooltipIconButton
      text={copy.multiSelect.download}
      side="top"
      disabled={count === 0}
      class="h-10 text-success {count > 0 ? 'gap-1 px-2.5' : 'size-10'}"
      onclick={onDownload}
    >
      <Download class="size-5" />
      {#if count > 0}
        <span class="text-xs tabular-nums text-muted-foreground">{humanSize(totalSize)}</span>
      {/if}
    </TooltipIconButton>

    <TooltipIconButton
      text={copy.multiSelect.unmark}
      side="top"
      disabled={!hasAnyMark}
      class="size-10 text-warning"
      onclick={onUnmark}
    >
      <Undo2 class="size-5" />
    </TooltipIconButton>

    {#if selfId === 0}
      <TooltipIconButton
        text={copy.multiSelect.delete}
        side="top"
        danger
        disabled={count === 0}
        class="size-10 text-destructive"
        onclick={onDelete}
      >
        <Trash2 class="size-5" />
      </TooltipIconButton>
    {/if}
  </div>
</div>
