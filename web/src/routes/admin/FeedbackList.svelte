<script lang="ts">
  import type { Feedback } from '$shared/types';
  import { MessageSquare, Trash2 } from '@lucide/svelte';
  import { copy, fmt } from '$shared/copy';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import ReorderableList from '$lib/components/ReorderableList.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
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
      class="ml-auto h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <Tooltip text={copy.admin.feedback.delete}>
            <button
              type="button"
              class="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={copy.admin.feedback.deleteAria}
              onclick={() => onDelete(feedbackItem.id)}
            >
              <Trash2 class="size-4" />
            </button>
          </Tooltip>
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
