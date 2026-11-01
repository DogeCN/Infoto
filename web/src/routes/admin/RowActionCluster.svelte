<script lang="ts">
  // The header of one admin card row: the row's identifying block on the left, its icon-button
  // cluster on the right. The frame is shared along with the cluster because the two decide
  // alignment together — a cluster cannot line up with another list's cluster while its own
  // header aligns its children differently. Each caller supplies its own `leading` block and
  // its own buttons; this component fixes only where they sit.
  import type { Snippet } from 'svelte';

  interface Props {
    /** The row's identifying block, left of the cluster. */
    leading: Snippet;
    /** The row's controls, in the order that row wants them. */
    children: Snippet;
  }

  let { leading, children }: Props = $props();
</script>

<div class="flex items-start justify-between gap-3">
  <!-- `min-w-0` lets the block shrink and wrap instead of pushing the cluster off the row. -->
  <div class="min-w-0 flex-1">
    {@render leading()}
  </div>
  <div class="flex shrink-0 items-center gap-1">
    {@render children()}
  </div>
</div>
