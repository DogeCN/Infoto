<script lang="ts">
  // Announcement sidebar. Everything is collapsed by default and the title row
  // toggles expansion; the collapse animates grid-template-rows 0fr <-> 1fr
  // while content stays mounted (markdown, votes and reactions keep state).
  // The feedback composer sticks to the bottom and sends fb_create ops.
  import type { Announcement } from "$shared/types";
  import { ChevronDown, ChevronsUpDown, Eye, Megaphone, Pencil } from "@lucide/svelte";
  import { parseVote } from "../../../core/vote";
  import { reactionCounts } from "../../../core/reactions";
  import MarkdownView from "./MarkdownView.svelte";
  import VoteBlock from "./VoteBlock.svelte";
  import ReactionBar from "./ReactionBar.svelte";
  import EmptyState from "./EmptyState.svelte";
  import Tooltip from "./Tooltip.svelte";
  import { formatAbsoluteTime, formatRelativeTime } from "$lib/time";

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
  // Textarea height (the top-right handle drag adjusts it: drag up to grow).
  let taH = $state(190);
  /** The set of expanded announcement ids (empty by default = all collapsed, so long announcements never fill the screen at once). */
  let expandedIds = $state<Set<number>>(new Set());

  function toggle(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  /** Read-only reaction tallies (emoji + count) for the collapsed meta row. */
  function reactionTally(ann: Announcement): { emoji: string; count: number }[] {
    return reactionCounts(ann, selfId).filter((r) => r.count > 0);
  }

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = taH;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      taH = Math.min(480, Math.max(120, startH - (ev.clientY - startY)));
    };
    const onUp = () => {
      el.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleSend() {
    const text = feedbackText.trim();
    if (!text) return;
    onFeedback?.(text);
    feedbackText = "";
    previewMode = false;
  }
</script>

<div class="flex min-h-full flex-col gap-4">
  <!-- Announcement list: a flat column with always-visible content (no collapse); scrolling is owned by the OverlaySidebar body. -->
  <div class="flex-1 space-y-4">
    {#if announcements.length === 0}
      <EmptyState icon={Megaphone} text="暂无公告" />
    {/if}

    {#each announcements as ann (ann.id)}
      {@const vote = parseVote(ann.contentMd)}
      {@const expanded = expandedIds.has(ann.id)}

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <!-- The title row is the toggle: the whole row is clickable; the right arrow shows the expand state. -->
        <h3 class="m-0">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted/40"
            aria-expanded={expanded}
            onclick={() => toggle(ann.id)}
          >
            <span class="flex-1 text-sm font-medium leading-snug"
              >{ann.title}</span
            >
            <ChevronDown
              class="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-exit)] ease-[var(--ease-exit)] {expanded
                ? ''
                : '-rotate-90'}"
            />
          </button>
        </h3>

        <!-- Meta row: relative update time (hover for absolute), an optimistic
             "syncing" badge while the temp id is unconfirmed by /sync, and a
             read-only reaction tally shown only when collapsed (the expanded
             area carries the interactive ReactionBar). -->
        <div class="flex flex-wrap items-center gap-2 px-4 text-xs text-muted-foreground/70">
          <Tooltip text={formatAbsoluteTime(ann.updatedAt)}>
            <span>{formatRelativeTime(ann.updatedAt)}</span>
          </Tooltip>
          {#if ann.id < 0}
            <span class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">同步中</span>
          {/if}
          {#if !expanded}
            {#each reactionTally(ann) as { emoji, count } (emoji)}
              <span class="inline-flex items-center gap-0.5 tabular-nums">{emoji} {count}</span>
            {/each}
          {/if}
        </div>

        <!-- Collapse/expand: a grid-template-rows 0fr↔1fr animation with content kept
             mounted (MarkdownView is not re-created, so vote and reaction state survive);
             min-h-0 lets 0fr collapse fully. -->
        <div
          class="grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
          style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
        >
          <div class="min-h-0 overflow-hidden">
            <div class="space-y-3 px-4 pb-4 pt-0.5">
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

              <!-- Reaction bar -->
              <ReactionBar
                announcement={ann}
                {selfId}
                onReact={(emoji) => onReact?.(ann.id, emoji)}
              />
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>

  <!-- Feedback input: pinned to the sidebar bottom, floating above the list while it scrolls.
       Same card background as the sidebar so it never looks like a brighter "overflow" band.
       z-20: inner z-indexed layers (vote bar, etc.) may appear inside cards, so sticky must sit above them. -->
  <div class="sticky bottom-0 z-20 mt-auto bg-card pb-4 pt-4">
    <!-- The wrapper owns the radius/border/clip: the textarea background always stays inside the radius. -->
    <div class="relative overflow-hidden rounded-xl border border-input bg-muted transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] focus-within:border-primary/50">
      {#if previewMode}
        <div class="min-h-[7.5rem] px-4 py-3" style="height: {taH}px">
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
          style="height: {taH}px"
          placeholder="写下你的建议"
          class="block w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        ></textarea>
      {/if}

      <!-- Top-right resize handle: drag up to grow, down to collapse. -->
      <Tooltip text="拖动调整高度">
        <div
          role="presentation"
          class="absolute right-1 top-1 flex h-5 w-5 cursor-ns-resize items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          onpointerdown={startResize}
        >
          <ChevronsUpDown class="size-3.5" />
        </div>
      </Tooltip>

      <Tooltip text={previewMode ? "编辑" : "预览"}>
        <button
          type="button"
          class="absolute right-8 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-background hover:text-foreground"
          onclick={() => (previewMode = !previewMode)}
        >
        {#if previewMode}
          <Pencil class="size-4" />
        {:else}
          <Eye class="size-4" />
        {/if}
      </button>
      </Tooltip>

      {#if feedbackText.trim()}
        <button
          type="button"
          class="absolute bottom-3 right-3 inline-flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90"
          onclick={handleSend}
        >
          发送
        </button>
      {/if}
    </div>
  </div>
</div>
