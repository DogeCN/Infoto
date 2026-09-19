<script lang="ts">
  import type { Announcement } from "$shared/types";
  import { ChevronDown, Eye, Pencil } from "@lucide/svelte";
  import { parseVote } from "../../../core/vote";
  import MarkdownView from "./MarkdownView.svelte";
  import VoteBlock from "./VoteBlock.svelte";
  import ReactionBar from "./ReactionBar.svelte";

  interface Props {
    announcements: Announcement[];
    selfId?: number;
    onReact?: (annId: number, emoji: string | null) => void;
    onVote?: (annId: number, option: number | null) => void;
    onFeedback?: (contentMd: string) => void;
  }

  let {
    announcements,
    selfId = -1,
    onReact,
    onVote,
    onFeedback,
  }: Props = $props();

  let feedbackText = $state("");
  let previewMode = $state(false);
  let openIds = $state<Set<number>>(new Set());

  function toggleAnn(id: number) {
    const next = new Set(openIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openIds = next;
  }

  function handleSend() {
    const text = feedbackText.trim();
    if (!text) return;
    onFeedback?.(text);
    feedbackText = "";
    previewMode = false;
  }
</script>

<div class="space-y-4">
  <!-- 公告列表：滚动由 OverlaySidebar 内容区承担，此处不再嵌套滚动 -->
  <div class="space-y-4">
    {#if announcements.length === 0}
      <p class="py-8 text-center text-sm text-muted-foreground">暂无公告</p>
    {/if}

    {#each announcements as ann (ann.id)}
      {@const isOpen = openIds.has(ann.id)}
      {@const vote = parseVote(ann.contentMd)}

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          class="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
          onclick={() => toggleAnn(ann.id)}
        >
          <h3 class="text-sm font-medium leading-none">{ann.title}</h3>
          <ChevronDown
            class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {isOpen
              ? 'rotate-180'
              : ''}"
          />
        </button>

        {#if isOpen}
          <div class="space-y-3 px-4 pb-4">
            {#if vote.body.trim()}
              <MarkdownView content={vote.body} class="text-muted-foreground" />
            {/if}

            {#if vote.options.length >= 2}
              <VoteBlock
                options={vote.options}
                votes={ann.votes}
                {selfId}
                onVote={(option) => onVote?.(ann.id, option)}
              />
            {/if}

            <!-- 表情反应条 -->
            <ReactionBar
              announcement={ann}
              {selfId}
              onReact={(emoji) => onReact?.(ann.id, emoji)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- 反馈输入区 -->
  <div class="sticky bottom-0 bg-popover pt-4 pb-2">
    <div class="relative">
      {#if previewMode}
        <div
          class="min-h-[7.5rem] rounded-xl border border-input bg-muted px-4 py-3"
        >
          {#if feedbackText.trim()}
            <MarkdownView
              content={feedbackText}
              class="text-muted-foreground"
            />
          {:else}
            <p class="text-sm text-muted-foreground">暂无内容</p>
          {/if}
        </div>
      {:else}
        <textarea
          bind:value={feedbackText}
          rows={5}
          placeholder="写下你的建议"
          class="w-full resize-y rounded-xl border border-input bg-muted px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        ></textarea>
      {/if}

      <button
        type="button"
        class="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        title={previewMode ? "编辑" : "预览"}
        onclick={() => (previewMode = !previewMode)}
      >
        {#if previewMode}
          <Pencil class="size-4" />
        {:else}
          <Eye class="size-4" />
        {/if}
      </button>

      {#if feedbackText.trim()}
        <button
          type="button"
          class="absolute right-3 bottom-3 inline-flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90"
          onclick={handleSend}
        >
          发送
        </button>
      {/if}
    </div>
  </div>
</div>
