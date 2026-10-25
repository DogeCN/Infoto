<script lang="ts">
  import type { Feedback } from '$shared/types';
  import { Check, Copy, MessageSquare, Trash2 } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$base/lib/clipboard';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import TooltipIconButton from '$lib/components/TooltipIconButton.svelte';
  import TimeLabel from '$lib/components/TimeLabel.svelte';
  import { filterFeedback } from './feedbackView';

  interface Props {
    feedback: Feedback[];
    onDelete: (id: number) => void;
    onReorder: (ids: number[]) => void;
  }

  let { feedback, onDelete, onReorder }: Props = $props();
  let query = $state('');
  let visibleFeedback = $derived(filterFeedback(feedback, query));

  /** How long the copied row shows its confirmation before the icon fades back. */
  const COPIED_HOLD_MS = 1600;
  /** The row that just copied, plus the timer that clears it. The confirmation is in place
   *  rather than a toast: the button the click landed on is where the user is looking. */
  let copiedId = $state<number | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function flashCopied(id: number): void {
    copiedId = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedId = null), COPIED_HOLD_MS);
  }
  onDestroy(() => clearTimeout(copiedTimer));

  /** Copy a feedback body verbatim; success is the boolean the clipboard owner returns, so the
   *  row keeps its own confirmation instead of a shared toast. */
  async function copyContent(item: Feedback): Promise<void> {
    if (await copyToClipboard(item.contentMd)) flashCopied(item.id);
    else toast.error(copy.lightbox.copyFailed);
  }

  /** A drag over a filtered list orders visible rows only: splice that order into
   * the full list's slots so hidden rows keep their position. */
  function commitVisibleOrder(visibleIds: number[]): void {
    const visibleSet = new Set(visibleIds);
    const slots: number[] = [];
    feedback.forEach((item, index) => {
      if (visibleSet.has(item.id)) slots.push(index);
    });
    if (slots.length !== visibleIds.length) return;
    const next = feedback.map((item) => item.id);
    slots.forEach((slot, k) => {
      next[slot] = visibleIds[k]!;
    });
    onReorder(next);
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <span
      class="inline-flex items-center rounded-full border border-transparent bg-secondary px-4 py-1 text-base font-semibold text-secondary-foreground"
    >
      {fmt(copy.admin.feedback.totalCount, { count: feedback.length })}
    </span>
    <input
      bind:value={query}
      type="search"
      placeholder={copy.admin.feedback.searchPlaceholder}
      aria-label={copy.admin.feedback.searchAria}
      class="field-control ml-auto h-9 max-w-xs px-3 py-0"
    />
  </div>

  {#if visibleFeedback.length === 0}
    <EmptyState
      icon={MessageSquare}
      text={query.trim() ? copy.admin.feedback.noMatches : copy.admin.feedback.empty}
    />
  {:else}
    <ReorderableList
      items={visibleFeedback}
      onReorder={commitVisibleOrder}
      listLabel={copy.admin.feedback.listLabel}
    >
      {#snippet row(feedbackItem)}
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-baseline gap-1 text-sm">
            <span class="text-muted-foreground">{copy.admin.feedback.idLabel}</span>
            <span class="font-semibold tabular-nums text-foreground">
              {feedbackItem.userId}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <TooltipIconButton
              text={copiedId === feedbackItem.id
                ? copy.admin.feedback.copied
                : copy.admin.feedback.copy}
              ariaLabel={copy.admin.feedback.copyAria}
              active={copiedId === feedbackItem.id}
              class="p-2"
              onclick={() => void copyContent(feedbackItem)}
            >
              <!-- The glyph swaps in place: the copy icon fades out and the check fades in
                   within one grid cell, so the button does not move or resize. -->
              <span class="grid size-4 place-items-center">
                <Copy
                  class="col-start-1 row-start-1 size-4 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {copiedId ===
                  feedbackItem.id
                    ? 'opacity-0'
                    : 'opacity-100'}"
                />
                <Check
                  class="col-start-1 row-start-1 size-4 transition-opacity duration-[var(--duration-exit)] ease-[var(--ease-exit)] {copiedId ===
                  feedbackItem.id
                    ? 'opacity-100'
                    : 'opacity-0'}"
                />
              </span>
            </TooltipIconButton>
            <TooltipIconButton
              text={copy.admin.feedback.delete}
              ariaLabel={copy.admin.feedback.deleteAria}
              danger
              class="p-2"
              onclick={() => onDelete(feedbackItem.id)}
            >
              <Trash2 class="size-4" />
            </TooltipIconButton>
          </div>
        </div>

        <div class="mt-2">
          <MarkdownView content={feedbackItem.contentMd} />
        </div>

        <div class="mt-3 flex justify-end">
          <TimeLabel
            time={feedbackItem.createdAt}
            align="end"
            class="text-xs text-muted-foreground tabular-nums"
          />
        </div>
      {/snippet}
    </ReorderableList>
  {/if}
</div>
