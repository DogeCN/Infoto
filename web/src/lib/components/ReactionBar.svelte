<script lang="ts">
  // GitHub-style reaction count buttons plus an add-reaction button. With no
  // reactions, only the add button shows.
  import { SmilePlus } from '@lucide/svelte';
  import { copy } from '$shared/copy';
  import { cn } from '$lib/utils';
  import { reactionCounts } from '../../core/reactions';
  import type { Announcement } from '$shared/types';
  import ReactionPicker from './ReactionPicker.svelte';
  import Tooltip from './Tooltip.svelte';

  interface Props {
    announcement: Announcement;
    selfId?: number;
    onReact?: (emoji: string | null) => void;
  }

  let { announcement, selfId = -1, onReact }: Props = $props();

  let counts = $derived(reactionCounts(announcement, selfId));
  let pickerOpen = $state(false);

  function toggle(emoji: string, selfReacted: boolean) {
    // A second click clears the reaction (empty emoji payload).
    onReact?.(selfReacted ? null : emoji);
    pickerOpen = false;
  }
</script>

<div class="relative flex flex-wrap items-center gap-1.5">
  {#each counts as { emoji, count, selfReacted } (emoji)}
    <button
      type="button"
      class={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        selfReacted
          ? 'border-primary text-primary'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
      onclick={() => toggle(emoji, selfReacted)}
    >
      <span>{emoji}</span>
      <span>{count}</span>
    </button>
  {/each}

  <Tooltip text={copy.reactions.add}>
    <button
      type="button"
      class="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onclick={() => (pickerOpen = !pickerOpen)}
    >
      <SmilePlus class="size-4" />
    </button>
  </Tooltip>

  {#if pickerOpen}
    <div class="absolute bottom-9 left-0 z-50">
      <ReactionPicker onPick={(emoji) => toggle(emoji, false)} />
    </div>
  {/if}
</div>
