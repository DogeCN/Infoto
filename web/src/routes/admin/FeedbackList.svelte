<script lang="ts">
  import type { Feedback } from '$shared/types';
  import { MessageSquare, Trash2 } from '@lucide/svelte';
  import EmptyState from '$lib/components/custom/EmptyState.svelte';
  import MarkdownView from '$lib/components/custom/MarkdownView.svelte';
  import Tooltip from '$lib/components/custom/Tooltip.svelte';
  import { formatAbsoluteTime } from '$lib/time';
  import { filterFeedback, toggleFeedback } from './feedbackView';

  interface Props {
    feedback: Feedback[];
    onDelete: (id: number) => void;
  }

  let { feedback, onDelete }: Props = $props();
  let query = $state('');
  let expandedId = $state<number | null>(null);
  let visibleFeedback = $derived(filterFeedback(feedback, query));

  function toggle(id: number): void {
    expandedId = toggleFeedback(expandedId, id);
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <span class="inline-flex items-center rounded-full border border-transparent bg-secondary px-4 py-1 text-base font-semibold text-secondary-foreground">
      共 {feedback.length} 条
    </span>
    <input
      bind:value={query}
      type="search"
      placeholder="按内容、反馈 ID 或用户 ID 过滤"
      aria-label="搜索建议"
      class="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  </div>

  {#if visibleFeedback.length === 0}
    <EmptyState icon={MessageSquare} text={query.trim() ? '没有匹配的建议' : '暂无建议'} />
  {:else}
    <div class="space-y-3" role="list" aria-label="建议列表">
      {#each visibleFeedback as feedbackItem (feedbackItem.id)}
        {@const expanded = expandedId === feedbackItem.id}
        <article
          class="rounded-xl border bg-card p-4 {expanded ? 'border-primary/50' : 'border-border'}"
          role="listitem"
        >
          <div class="flex items-start gap-3">
            <button
              type="button"
              class="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-controls="feedback-content-{feedbackItem.id}"
              aria-label={expanded ? '收起建议' : '展开建议'}
              onclick={() => toggle(feedbackItem.id)}
            >
              {#if expanded}
                <span class="text-sm font-medium">建议内容</span>
              {:else}
                <span class="line-clamp-2 block whitespace-pre-wrap text-sm text-foreground">
                  {feedbackItem.contentMd}
                </span>
              {/if}
            </button>
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

          {#if expanded}
            <div id="feedback-content-{feedbackItem.id}" class="mt-4 border-t border-border pt-4">
              <MarkdownView
                content={feedbackItem.contentMd}
                class="[&_img]:max-w-full [&_img]:rounded-lg"
              />
              <dl class="mt-4 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                <div class="flex gap-1">
                  <dt>反馈 ID</dt>
                  <dd class="tabular-nums text-foreground">{feedbackItem.id}</dd>
                </div>
                <div class="flex gap-1">
                  <dt>用户 ID</dt>
                  <dd class="tabular-nums text-foreground">{feedbackItem.userId}</dd>
                </div>
                <div class="flex gap-1">
                  <dt>时间</dt>
                  <dd>{formatAbsoluteTime(feedbackItem.createdAt)}</dd>
                </div>
              </dl>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>
