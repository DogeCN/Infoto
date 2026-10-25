<script lang="ts">
  // The gallery's sort pill. It renders the density it is handed and forwards the measured
  // widths, so the top bar resolves the bar mode from one measurement rather than two.
  import type { SortKey } from '../../core/gallery';
  import SortTabs from './SortTabs.svelte';

  interface Props {
    sortKey?: SortKey;
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
    /** Which variant is in the flow. */
    showLabels: boolean;
    /**
     * Natural widths of both variants. `shown` is measured live; the other is
     * `shown ± labelDelta`. The parent decides density from these.
     */
    onWidths?: (info: { shown: number; shownIsLabelled: boolean; labelDelta: number }) => void;
  }

  let {
    sortKey = 'latest',
    dirs = {},
    onChange,
    onReshuffle,
    showLabels,
    onWidths,
  }: Props = $props();
</script>

<div class="shrink-0">
  <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} hideLabel={!showLabels} {onWidths} />
</div>
