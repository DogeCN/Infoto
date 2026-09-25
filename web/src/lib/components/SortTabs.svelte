<script lang="ts">
  // Reactive sort pill (spec: "custom component list" / "home page"): three-segment selector —
  // newest / hottest / random, icon and text diff with state, label hidden when narrow with a
  // native title for the name (contract: no DropdownMenu fallback). SegmentedControl provides the visuals and the sliding pill; this component owns only the domain logic (per-item direction, random reshuffle).
  import {
    ArrowDownWideNarrow,
    ArrowUpWideNarrow,
    Flame,
    Snowflake,
    Shuffle,
  } from '@lucide/svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import type { SegmentedItem } from '$lib/components/SegmentedControl.svelte';

  export type SortKey = 'latest' | 'hottest' | 'random';

  interface Props {
    sortKey?: SortKey;
    /**
     * The direction each sort item **remembers for itself** (newest↔oldest, hottest↔coldest).
     * Passing only the active direction would revert inactive items to default labels when you
     * switch away, jumping to the real direction only on the way back (a visual glitch).
     */
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
  }

  let { sortKey = 'latest', dirs = {}, onChange, onReshuffle }: Props = $props();

  const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'latest', label: '最新' },
    { key: 'hottest', label: '最热' },
    { key: 'random', label: '随机' },
  ];

  function iconFor(key: SortKey, asc: boolean) {
    if (key === 'latest') return asc ? ArrowUpWideNarrow : ArrowDownWideNarrow;
    if (key === 'hottest') return asc ? Snowflake : Flame;
    return Shuffle;
  }

  function labelFor(key: SortKey, asc: boolean): string {
    if (key === 'latest') return asc ? '最旧' : '最新';
    if (key === 'hottest') return asc ? '最冷' : '最热';
    return '随机';
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
  ariaLabel="排序方式"
  onChange={(k) => onChange?.(k)}
  onReselect={(k) => {
    if (k === 'random') {
      // Random item: clicking again = reshuffle (the short-circuit branch of the old 24b1bf2 pick)
      onReshuffle?.();
    } else {
      // Newest/hottest: clicking again flips direction (newest↔oldest / hottest↔coldest). The old
      // version routed "re-click active" through onChange, where the parent's onSortChange flipped
      // direction in its key===sortKey branch; the refactor dropped that path, so clicks couldn't flip.
      onChange?.(k);
    }
  }}
/>
