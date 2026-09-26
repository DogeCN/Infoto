<script lang="ts">
  // Announcement vote control: one button per option with a vote-share fill bar.
  // Semantics: click an option to vote; click the chosen one again to retract (option
  // null, backend-supported); click another to change the vote.
  import type { Vote } from '$shared/types';
  import { copy, fmt } from '$shared/copy';

  interface Props {
    options: string[];
    votes: Vote[];
    selfId?: number;
    onVote?: (option: number | null) => void;
  }

  let { options, votes, selfId = -1, onVote }: Props = $props();

  // Vote count per option & whether it is the highest
  let counts = $derived.by(() => {
    const c = new Array<number>(options.length).fill(0);
    for (const v of votes) {
      if (v.option >= 0 && v.option < options.length) c[v.option]!++;
    }
    return c;
  });

  let total = $derived(counts.reduce((a, b) => a + b, 0));
  let max = $derived(counts.length ? Math.max(...counts) : 0);
  // Option index the current user voted for (-1 = not voted)
  let chosen = $derived(votes.findLast((v) => v.userId === selfId)?.option ?? -1);

  function handle(option: number) {
    onVote?.(chosen === option ? null : option);
  }
</script>

<div class="space-y-1.5">
  {#each options as label, idx (idx)}
    {@const count = counts[idx]}
    {@const pct = total ? (count / total) * 100 : 0}
    {@const isChosen = chosen === idx}
    {@const isWinner = max > 0 && count === max}
    <!-- isolate: keeps the internal z-10 inside the button's own stacking context. Otherwise a
         relative + z-index:auto button builds no layer, so the inner z-10 escapes to the outer
         context and climbs past the parent's sticky frame (this really did clip through). -->
    <button
      type="button"
      class="relative isolate w-full overflow-hidden rounded-md border px-3 py-2 text-left transition-colors duration-200 {isChosen
        ? 'border-primary/50 bg-primary/5'
        : 'border-border bg-transparent hover:bg-muted/50 hover:border-primary/30'}"
      onclick={() => handle(idx)}
    >
      <!-- Fill bar: low-opacity primary, expands with the vote share -->
      <span
        class="vote-fill absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-500 ease-out"
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
            {fmt(copy.vote.count, { count })}
          </span>
        </span>
      </span>
    </button>
  {/each}
</div>
