<script lang="ts">
  // The sort pill, in both densities, with only one of them in the flow.
  //
  // Both variants render at all times: the inactive one is `invisible absolute`, which
  // takes it out of the flow (no width consumed, no geometry change) while still laying
  // it out. That is what lets the top bar *measure* the variant it is not currently
  // showing, so the density decision is made from real widths instead of a viewport
  // breakpoint. The trade is a second SortTabs instance; its cost is a few DOM nodes and
  // no extra network work.
  import type { SortKey } from './SortTabs.svelte';
  import SortTabs from './SortTabs.svelte';

  interface Props {
    sortKey?: SortKey;
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
    /** Which variant is in the flow; the other is measured but invisible. */
    showLabels: boolean;
    /** Receives the two variant wrappers so the parent can measure them. */
    onMeasure?: (full: HTMLElement, compact: HTMLElement) => void;
  }

  let {
    sortKey = 'latest',
    dirs = {},
    onChange,
    onReshuffle,
    showLabels,
    onMeasure,
  }: Props = $props();

  let fullEl: HTMLElement | undefined = $state(undefined);
  let compactEl: HTMLElement | undefined = $state(undefined);

  $effect(() => {
    if (fullEl && compactEl) onMeasure?.(fullEl, compactEl);
  });
</script>

<div class="relative shrink-0">
  <div
    bind:this={fullEl}
    class={showLabels ? '' : 'invisible absolute'}
    aria-hidden={showLabels ? undefined : 'true'}
  >
    <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} />
  </div>
  <div
    bind:this={compactEl}
    class={showLabels ? 'invisible absolute' : ''}
    aria-hidden={showLabels ? 'true' : undefined}
  >
    <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} hideLabel />
  </div>
</div>
