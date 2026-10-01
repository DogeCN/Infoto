<script lang="ts">
  // Poll results and controls are rendered from the canonical poll snapshot.
  import type { Poll } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { fmt, plural } from '$shared/copy';

  interface Props {
    poll: Poll;
    selfId?: number;
    interactive?: boolean;
    onVote?: (options: number[]) => void;
  }

  let { poll, selfId = -1, interactive = true, onVote }: Props = $props();

  let counts = $derived.by(() => {
    const result = new Array<number>(poll.options.length).fill(0);
    for (const vote of poll.votes) {
      if (vote.option >= 0 && vote.option < result.length) result[vote.option]!++;
    }
    return result;
  });

  let total = $derived(counts.reduce((sum, count) => sum + count, 0));
  let max = $derived(counts.length ? Math.max(...counts) : 0);
  let chosen = $derived(
    new Set(poll.votes.filter((vote) => vote.userId === selfId).map((vote) => vote.option)),
  );

  function select(option: number): void {
    if (!interactive) return;
    const next = poll.allowMultiple ? new Set(chosen) : new Set<number>();
    if (chosen.has(option)) next.delete(option);
    else next.add(option);
    onVote?.([...next].sort((a, b) => a - b));
  }
</script>

<div class="space-y-1.5" aria-label={poll.title}>
  {#each poll.options as label, idx (idx)}
    {@const count = counts[idx] ?? 0}
    {@const pct = total ? (count / total) * 100 : 0}
    {@const isChosen = chosen.has(idx)}
    {@const isWinner = max > 0 && count === max}
    <button
      type="button"
      class="relative isolate w-full overflow-hidden rounded-md border px-3 py-2 text-left transition-colors duration-[var(--duration-exit)] {isChosen
        ? 'border-primary/50 bg-primary/5'
        : 'border-border bg-transparent hover:bg-muted/50 hover:border-primary/30'} {interactive
        ? 'cursor-pointer'
        : 'cursor-default'}"
      aria-pressed={isChosen}
      disabled={!interactive}
      onclick={() => select(idx)}
    >
      <span
        class="vote-fill absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
        style="width: {pct.toFixed(1)}%"
      ></span>
      <span class="vote-meta relative z-10 flex items-center justify-between gap-2">
        <span
          class="text-sm leading-tight {isChosen || isWinner ? 'text-primary' : 'text-foreground'}"
        >
          {label}
        </span>
        <span class="inline-flex items-baseline gap-1.5 tabular-nums">
          <span class="font-mono text-xs text-primary">{pct.toFixed(0)}%</span>
          <span class="font-mono text-[11px] text-muted-foreground/70">
            {fmt(plural(count, copy.vote.count), { count })}
          </span>
        </span>
      </span>
    </button>
  {/each}
</div>
