<script lang="ts">
  // Renders announcement content: Markdown blocks interleaved with the polls they
  // reference. A reference with no matching poll renders as a plain `::vote:` line.
  import type { Poll } from '$shared/types';
  import { splitPollReferences, type MarkdownPollPart } from '../../core/markdown';
  import MarkdownView from './MarkdownView.svelte';
  import VoteBlock from './VoteBlock.svelte';

  interface Props {
    /** Announcement Markdown; poll references are split out of it. */
    content: string;
    /** Every known poll, so a reference can be resolved to its live options. */
    polls?: Poll[];
    selfId?: number;
    /** Let the reader vote. Off for previews and the admin list. */
    interactive?: boolean;
    onVote?: (pollId: number, options: number[]) => void;
  }

  let { content, polls = [], selfId = -1, interactive = false, onVote }: Props = $props();

  let parts = $derived(splitPollReferences(content));
  let pollMap = $derived(new Map(polls.map((poll) => [poll.id, poll])));

  /** Vote rows are interactive only when a handler is supplied. */
  let canVote = $derived(interactive && onVote !== undefined);

  function section(part: Extract<MarkdownPollPart, { type: 'poll' }>): Poll | undefined {
    return pollMap.get(part.id);
  }
</script>

<div class="flex flex-col gap-4">
  {#each parts as part, index (`${index}:${part.type}`)}
    {#if part.type === 'markdown'}
      {#if part.content.trim()}
        <MarkdownView content={part.content} allowImages class="text-muted-foreground" />
      {/if}
    {:else if section(part)}
      {@const poll = section(part)!}
      <section class="space-y-2" aria-label={poll.title}>
        <h4 class="text-sm font-medium text-foreground">{poll.title}</h4>
        <VoteBlock
          options={poll.options}
          votes={poll.votes}
          allowMultiple={poll.allowMultiple}
          interactive={canVote}
          {selfId}
          onVote={(options) => onVote?.(poll.id, options)}
        />
      </section>
    {:else}
      <MarkdownView content={`::vote:${part.id}`} allowImages class="text-muted-foreground" />
    {/if}
  {/each}
</div>
