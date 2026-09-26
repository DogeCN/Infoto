<script lang="ts">
  // Three-segment sort selector: newest / hottest / random, icon and text diff with
  // state, label hidden when narrow with a native title for the name. SegmentedControl
  // provides the visuals; this component owns the domain logic (per-item direction, random reshuffle).
  import { Clock4, Clock10, Flame, Snowflake, Shuffle } from '@lucide/svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import type { SegmentedItem } from '$lib/components/SegmentedControl.svelte';
  import { copy } from '$shared/copy';

  export type SortKey = 'latest' | 'hottest' | 'random';

  interface Props {
    sortKey?: SortKey;
    /** The direction each sort item remembers for itself (newest↔oldest, hottest↔coldest):
     *  with only the active direction passed, inactive items revert to default labels on
     *  switch-away and jump to the real direction only on the way back. */
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
  }

  let { sortKey = 'latest', dirs = {}, onChange, onReshuffle }: Props = $props();

  const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'latest', label: copy.sort.latest },
    { key: 'hottest', label: copy.sort.hottest },
    { key: 'random', label: copy.sort.random },
  ];

  function iconFor(key: SortKey, asc: boolean) {
    // Newest = clock hand at 4 o'clock, oldest = hand at 10 o'clock (opposite direction).
    if (key === 'latest') return asc ? Clock10 : Clock4;
    if (key === 'hottest') return asc ? Snowflake : Flame;
    return Shuffle;
  }

  function labelFor(key: SortKey, asc: boolean): string {
    if (key === 'latest') return asc ? copy.sort.oldest : copy.sort.latest;
    if (key === 'hottest') return asc ? copy.sort.coldest : copy.sort.hottest;
    return copy.sort.random;
  }

  // Labels/icons diff with dirs, fed to the generic pill.
  const items = $derived<ReadonlyArray<SegmentedItem<SortKey>>>(
    SORTS.map((s) => {
      const asc = dirs[s.key] ?? false;
      return { value: s.key, label: labelFor(s.key, asc), icon: iconFor(s.key, asc) };
    }),
  );
</script>

<SegmentedControl
  {items}
  value={sortKey}
  responsiveHideLabel
  ariaLabel={copy.sort.ariaLabel}
  onChange={(k) => onChange?.(k)}
  onReselect={(k) => {
    // Re-clicking the active tab: random reshuffles, newest/hottest flip direction
    // (the parent owns the direction state and flips it in its onChange branch).
    if (k === 'random') onReshuffle?.();
    else onChange?.(k);
  }}
/>
