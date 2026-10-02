<script lang="ts">
  // Render the selected density and report the alternate label layout's width.
  import type { SortKey } from '../../core/gallery';
  import { measurePillWidths, type PillWidths } from './pillMeasure';
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

  /** Dependency key for label text: the delta itself is measured from the DOM. */
  function labelsKey(sortKey: SortKey, dirs: Partial<Record<SortKey, boolean>>): string {
    return `${sortKey}:${JSON.stringify(dirs)}:${document.documentElement.lang}`;
  }

  // Refresh when the label text can change, not when showLabels flips. A density change is
  // a consequence of the measurement and must not re-trigger it.
  const measure = $derived.by(() => {
    void labelsKey(sortKey, dirs);
    return {
      labelled: showLabels,
      deps: labelsKey(sortKey, dirs),
      onWidths: (info: PillWidths) => onWidths?.(info),
    };
  });
</script>

<div class="shrink-0">
  <div use:measurePillWidths={measure}>
    <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} hideLabel={!showLabels} />
  </div>
</div>
