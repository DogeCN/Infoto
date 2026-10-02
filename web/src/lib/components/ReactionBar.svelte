<script lang="ts">
  // GitHub-style reaction count buttons plus an add-reaction button. With no
  // reactions, only the add button shows.
  import { SmilePlus } from '@lucide/svelte';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import { cn } from '$base/lib/ui';
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
  const pickerId = $props.id();
  let pickerAnchor = $state<HTMLButtonElement>();

  function toggle(emoji: string, selfReacted: boolean) {
    // A second click clears the reaction (empty emoji payload).
    onReact?.(selfReacted ? null : emoji);
  }
</script>

<div class="relative flex flex-wrap items-center gap-1.5">
  {#each counts as { emoji, count, selfReacted } (emoji)}
    <button
      type="button"
      aria-label={fmt(copy.reactions.toggle, { emoji, count })}
      aria-pressed={selfReacted}
      class={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
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
      aria-label={copy.reactions.add}
      type="button"
      class="icon-button size-7 rounded-full hover:bg-muted hover:text-foreground"
      bind:this={pickerAnchor}
      popovertarget={pickerId}
    >
      <SmilePlus class="size-4" />
    </button>
  </Tooltip>

  <ReactionPicker id={pickerId} anchor={pickerAnchor} onPick={(emoji) => toggle(emoji, false)} />
</div>
