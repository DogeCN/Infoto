<script lang="ts">
  // Localized sort selector with per-key directions and random reshuffling. Density is supplied by the top bar.
  import { Clock4, Clock10, Flame, Snowflake, Shuffle } from '@lucide/svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import type { SegmentedItem } from '$lib/components/SegmentedControl.svelte';
  import { copy } from '$lib/i18n.svelte';
  import type { SortKey } from '../../core/gallery';

  interface Props {
    sortKey?: SortKey;
    /** Remembered ascending direction for each sort key. */
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
    /** Icon-only: the top bar hides the labels when the pill is actually squeezed. */
    hideLabel?: boolean;
  }

  let { sortKey = 'latest', dirs = {}, onChange, onReshuffle, hideLabel = false }: Props = $props();

  // Keys only — the labels come from `labelFor`, which reads `copy` per item so a
  // language switch re-renders them.
  const SORTS: ReadonlyArray<SortKey> = ['latest', 'hottest', 'random'];

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
    SORTS.map((key) => {
      const asc = dirs[key] ?? false;
      return { value: key, label: labelFor(key, asc), icon: iconFor(key, asc) };
    }),
  );
</script>

<SegmentedControl
  {items}
  value={sortKey}
  {hideLabel}
  ariaLabel={copy.sort.ariaLabel}
  onChange={(k) => onChange?.(k)}
  onReselect={(k) => {
    // Re-clicking the active tab: random reshuffles, newest/hottest flip direction
    // (the parent owns the direction state and flips it in its onChange branch).
    if (k === 'random') onReshuffle?.();
    else onChange?.(k);
  }}
/>
