<script lang="ts">
  // Emoji picker popover (spec: "custom component list") — eight fixed emoji.
  import { EMOJI_SET } from '../../core/reactions';

  interface Props {
    onPick?: (emoji: string) => void;
  }

  let { onPick }: Props = $props();
</script>

<div
  class="grid w-[168px] grid-cols-4 gap-1 rounded-lg border border-border bg-popover p-1 shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
>
  {#each EMOJI_SET as emoji (emoji)}
    <button
      type="button"
      class="flex size-8 items-center justify-center rounded-md text-base transition-colors hover:bg-muted"
      onclick={() => onPick?.(emoji)}
    >
      {emoji}
    </button>
  {/each}
</div>
