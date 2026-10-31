<script lang="ts">
  // The gallery's sort pill. It renders the density it is handed and forwards the measured
  // widths, so the top bar resolves the bar mode from one measurement rather than two.
  import type { SortKey } from '../../core/gallery';
  import SortTabs from './SortTabs.svelte';
  import type { PillWidths } from './pillMeasure';

  interface Props {
    sortKey?: SortKey;
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
    /** Label density contract passed from the top bar: 'all' | 'current' | 'none'. */
    labelMode?: 'all' | 'current' | 'none';
    /** Density report, forwarded from the shared pill measurement. */
    onWidths?: (widths: PillWidths) => void;
  }

  let {
    sortKey = 'latest',
    dirs = {},
    onChange,
    onReshuffle,
    labelMode = 'all',
    onWidths,
  }: Props = $props();
</script>

<div class="shrink-0">
  <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} {labelMode} {onWidths} />
</div>
