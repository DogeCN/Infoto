<script lang="ts">
  import type { Feedback } from '$shared/types';
  import { MessageSquare, Trash2 } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { formatAbsoluteTime } from '$lib/time';
  import { filterFeedback } from './feedbackView';

  interface Props {
    feedback: Feedback[];
    onDelete: (id: number) => void;
  }

  let { feedback, onDelete }: Props = $props();
  let query = $state('');
  let visibleFeedback = $derived(filterFeedback(feedback, query));
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <span
      class="inline-flex items-center rounded-full border border-transparent bg-secondary px-4 py-1 text-base font-semibold text-secondary-foreground"
    >
      共 {feedback.length} 条
    </span>
    <input
      bind:value={query}
      type="search"
      placeholder="搜索"
      aria-label="搜索建议"
      class="ml-auto h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  </div>

  {#if visibleFeedback.length === 0}
    <EmptyState icon={MessageSquare} text={query.trim() ? '没有匹配的建议' : '暂无建议'} />
  {:else}
    <div class="space-y-3" role="list" aria-label="建议列表">
      {#each visibleFeedback as feedbackItem (feedbackItem.id)}
        <article class="rounded-xl border border-border bg-card p-4" role="listitem">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-baseline gap-1 text-sm">
              <span class="text-muted-foreground">ID</span>
              <span class="font-semibold tabular-nums text-foreground">
                {feedbackItem.userId}
              </span>
            </div>
            <Tooltip text="删除">
              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="删除建议"
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
            <time class="text-xs text-muted-foreground">
              {formatAbsoluteTime(feedbackItem.createdAt)}
            </time>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
