<script lang="ts">
  import type { Poll } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import { splitVoteReferences } from '../../core/markdown';
  import MarkdownView from './MarkdownView.svelte';
  import VoteBlock from './VoteBlock.svelte';

  interface Props {
    content: string;
    polls?: Poll[];
    selfId?: number;
    interactive?: boolean;
    allowImages?: boolean;
    class?: string;
    onVote?: (pollId: number, options: number[]) => void;
  }

  let {
    content,
    polls = [],
    selfId = -1,
    interactive = true,
    allowImages = false,
    class: className = '',
    onVote,
  }: Props = $props();

  let blocks = $derived(splitVoteReferences(content));
</script>

<div class="space-y-3">
  {#each blocks as block, index (`${block.type}-${index}`)}
    {#if block.type === 'markdown'}
      {#if block.content.trim()}
        <MarkdownView content={block.content} {allowImages} class={className} />
      {/if}
    {:else}
      {@const poll = polls.find((item) => item.id === block.pollId)}
      {#if poll}
        <VoteBlock {poll} {selfId} {interactive} onVote={(options) => onVote?.(poll.id, options)} />
      {:else}
        <p class="text-xs text-muted-foreground">{fmt(copy.vote.missing, { id: block.pollId })}</p>
      {/if}
    {/if}
  {/each}
</div>
