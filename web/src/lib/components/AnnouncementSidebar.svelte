<script lang="ts">
  import type { Announcement } from '$shared/types';
  import { copy } from '$shared/copy';
  import { ChevronDown, ChevronsUpDown, Eye, Pencil } from '@lucide/svelte';
  import { splitVote } from '../../core/vote';
  import MarkdownView from './MarkdownView.svelte';
  import VoteBlock from './VoteBlock.svelte';
  import ReactionBar from './ReactionBar.svelte';

  interface Props {
    announcements: Announcement[];
    selfId?: number;
    onReact?: (annId: number, emoji: string | null) => void;
    onVote?: (annId: number, option: number | null) => void;
    onFeedback?: (contentMd: string) => void;
  }

  let { announcements, selfId = -1, onReact, onVote, onFeedback }: Props = $props();

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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
      {@const vote = splitVote(ann.contentMd)}
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
          style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
        >
          <div class="min-h-0 overflow-hidden">
            <div class="space-y-3 px-4 pb-4 pt-0.5">
              {#if vote.before.trim()}
                <MarkdownView content={vote.before} allowImages class="text-muted-foreground" />
              {/if}

              {#if vote.options.length >= 2}
                <VoteBlock
                  options={vote.options}
                  votes={ann.votes}
                  {selfId}
                  onVote={(option) => onVote?.(ann.id, option)}
                />
              {/if}

              {#if vote.after.trim()}
                <MarkdownView content={vote.after} allowImages class="text-muted-foreground" />
              {/if}

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

  <!-- Feedback input: pinned to the bottom of the sidebar, floating above the content as announcements scroll.
       Its background matches the sidebar (card) so it never glows brighter than the content like an "overflow".
       z-20: the card can hold z-indexed inner layers (vote bar etc.) that this sticky element must stay above -->
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
      <div
        role="presentation"
        class="absolute right-1 top-1 flex h-5 w-5 cursor-ns-resize items-center justify-center text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        title={copy.announcements.resizeHandle}
        onpointerdown={startResize}
      >
        <ChevronsUpDown class="size-3.5" />
      </div>

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
