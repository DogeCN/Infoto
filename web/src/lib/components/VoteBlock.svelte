<script lang="ts">
  // Poll control: one selected option for single-choice polls, a set for multi-choice polls.
  import type { Vote } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
  import { fmt, plural } from '$shared/copy';

  interface Props {
    options: string[];
    votes: Vote[];
    allowMultiple?: boolean;
    interactive?: boolean;
    selfId?: number;
    onVote?: (options: number[]) => void;
  }

  let {
    options,
    votes,
    allowMultiple = false,
    interactive = true,
    selfId = -1,
    onVote,
  }: Props = $props();

  let counts = $derived.by(() => {
    const result = new Array<number>(options.length).fill(0);
    for (const vote of votes) {
      if (vote.option >= 0 && vote.option < options.length) result[vote.option]!++;
    }
    return result;
  });
  let total = $derived(counts.reduce((sum, count) => sum + count, 0));
  let max = $derived(counts.length ? Math.max(...counts) : 0);
  let chosen = $derived(
    new Set(votes.filter((vote) => vote.userId === selfId).map((vote) => vote.option)),
  );

  // Semantics: click an option to vote; click a chosen one again to retract. A
  // single-choice poll replaces the previous vote; a multi-choice poll toggles each
  // option independently.
  function handle(option: number): void {
    if (!interactive || !onVote) return;
    const next = new Set(chosen);
    if (next.has(option)) next.delete(option);
    else if (allowMultiple) next.add(option);
    else {
      next.clear();
      next.add(option);
    }
    onVote([...next].sort((a, b) => a - b));
  }
</script>

<div class="space-y-1.5">
  {#each options as label, idx (idx)}
    {@const count = counts[idx] ?? 0}
    {@const pct = total ? (count / total) * 100 : 0}
    {@const isChosen = chosen.has(idx)}
    {@const isWinner = max > 0 && count === max}
    <!-- Interactive rows are buttons; the read-only render is a results chart, not a
         control — a disabled button would drag the whole block to the global disabled
         opacity and wash the results out. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svelte:element
      this={interactive ? 'button' : 'div'}
      type={interactive ? 'button' : undefined}
      aria-pressed={interactive ? isChosen : undefined}
      onclick={interactive ? () => handle(idx) : undefined}
      class="relative isolate w-full overflow-hidden rounded-md border px-3 py-2 text-left transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isChosen
        ? 'border-primary/50 bg-primary/5'
        : interactive
          ? 'border-border bg-transparent hover:bg-muted/50 hover:border-primary/30'
          : 'border-border bg-transparent'}"
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
        <!-- A poll nobody has answered yet would read as "0% 0 votes" on every row, which
             is noise rather than information. The fill bar already shows an empty poll. -->
        {#if total > 0}
          <span class="inline-flex items-baseline gap-1.5 tabular-nums">
            <span class="font-mono text-xs text-primary">{pct.toFixed(0)}%</span>
            <span class="font-mono text-[11px] text-muted-foreground/70">
              {fmt(plural(count, copy.vote.count), { count })}
            </span>
          </span>
        {/if}
      </span>
    </svelte:element>
  {/each}
</div>
