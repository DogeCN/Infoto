<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Announcement, Poll } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { ChevronDown, ChevronsUpDown, Eye, Pencil } from '@lucide/svelte';
  import RichMarkdown from './RichMarkdown.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import ReactionBar from './ReactionBar.svelte';

  interface Props {
    announcements: Announcement[];
    polls: Poll[];
    selfId?: number;
    onReact?: (annId: number, emoji: string | null) => void;
    onVote?: (pollId: number, options: number[]) => void;
    onFeedback?: (contentMd: string) => void;
  }

  let { announcements, polls, selfId = -1, onReact, onVote, onFeedback }: Props = $props();

  let feedbackText = $state('');
  let previewMode = $state(false);
  // Textarea height (drag the top-right handle upward to enlarge)
  let taH = $state(190);
  /** Ids of expanded announcements (empty = all collapsed, so long posts cannot fill the screen). */
  let expandedIds = $state<Set<number>>(new Set());

  function toggle(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  let stopResize = () => {};
  onDestroy(() => stopResize());

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    stopResize();
    event.preventDefault();
    const startY = event.clientY;
    const startH = taH;
    const onMove = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId)
        taH = Math.min(480, Math.max(120, startH - (next.clientY - startY)));
    };
    const onEnd = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) stopResize();
    };
    stopResize = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function handleSend() {
    const text = feedbackText.trim();
    if (!text) return;
    onFeedback?.(text);
    feedbackText = '';
    previewMode = false;
  }
</script>

<div class="flex min-h-full flex-col gap-4">
  <!-- Announcement list: all items laid out flat; scrolling is handled by the OverlaySidebar content area -->
  <div class="flex-1 space-y-4">
    {#if announcements.length === 0}
      <p class="py-8 text-center text-sm text-muted-foreground">{copy.announcements.empty}</p>
    {/if}

    {#each announcements as ann (ann.id)}
      {@const expanded = expandedIds.has(ann.id)}

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <!-- The title row is the toggle: the whole row is clickable, the chevron on the right indicates the expanded state -->
        <h3 class="m-0">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted/40"
            aria-expanded={expanded}
            onclick={() => toggle(ann.id)}
          >
            <span class="flex-1 text-sm font-medium leading-snug">{ann.title}</span>
            <ChevronDown
              class="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-exit)] ease-[var(--ease-exit)] {expanded
                ? ''
                : '-rotate-90'}"
            />
          </button>
        </h3>

        <!-- Collapse/expand: grid-template-rows 0fr↔1fr animation keeps the content mounted
             (MarkdownView does not remount, vote and reaction state survive); min-h-0 lets 0fr squash -->
        <div
          class="grid transition-[grid-template-rows] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
          inert={!expanded}
          aria-hidden={!expanded}
          style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
        >
          <div class="min-h-0 overflow-hidden">
            <div class="space-y-3 px-4 pb-4 pt-0.5">
              <RichMarkdown
                content={ann.contentMd}
                {polls}
                {selfId}
                allowImages
                class="text-muted-foreground"
                onVote={(pollId, options) => onVote?.(pollId, options)}
              />

              <!-- Emoji reaction bar -->
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

  <!-- Sticky feedback input above the scrollable announcement content. -->
  <div class="sticky bottom-0 z-20 mt-auto bg-card pb-4 pt-4">
    <!-- The wrapper owns radius/border/clipping: the textarea background always stays inside the rounded corners -->
    <div
      class="relative overflow-hidden rounded-xl border border-input bg-muted transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] focus-within:border-primary/50"
    >
      {#if previewMode}
        <div class="min-h-[7.5rem] px-4 py-3" style="height: {taH}px">
          {#if feedbackText.trim()}
            <MarkdownView content={feedbackText} class="text-muted-foreground" />
          {:else}
            <p class="text-sm text-muted-foreground">{copy.announcements.previewEmpty}</p>
          {/if}
        </div>
      {:else}
        <textarea
          bind:value={feedbackText}
          style="height: {taH}px"
          placeholder={copy.announcements.feedbackPlaceholder}
          class="block w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        ></textarea>
      {/if}

      <!-- Resize handle at the top right: drag up to grow, down to shrink -->
      <button
        type="button"
        aria-label={copy.announcements.resizeHandle}
        class="absolute right-1 top-1 flex h-5 w-5 cursor-ns-resize items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        title={copy.announcements.resizeHandle}
        onpointerdown={startResize}
        onkeydown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          taH = Math.min(480, Math.max(120, taH + (event.key === 'ArrowUp' ? 16 : -16)));
        }}
      >
        <ChevronsUpDown class="size-3.5" />
      </button>

      <button
        type="button"
        class="absolute right-8 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-background hover:text-foreground"
        title={previewMode ? copy.announcements.editToggle : copy.announcements.previewToggle}
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
          class="absolute bottom-3 right-3 inline-flex items-center justify-center rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:bg-primary/90"
          onclick={handleSend}
        >
          {copy.announcements.send}
        </button>
      {/if}
    </div>
  </div>
</div>
