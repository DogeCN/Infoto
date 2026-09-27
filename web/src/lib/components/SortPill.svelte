<script lang="ts">
  // Sort pill at the density the top bar chose.
  //
  // Only the visible variant is in the flow. The other width is `shown ± labelDelta`,
  // measured from a normal-flow clone (`width: max-content`). A hidden absolute twin
  // reports the containing block, not content width, and a second in-flow variant
  // changes the slot width when density flips, which feeds the measurement back into
  // the decision.
  import type { SortKey } from './SortTabs.svelte';
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

  let shownEl: HTMLElement | undefined = $state(undefined);
  /**
   * How much wider the labelled variant is than the icon-only one, in px.
   *
   * Measured from a clone laid out in normal flow (`width: max-content`), because that
   * is the only way to get a content width that does not depend on how the node is
   * hidden. It depends on the label text, so it is refreshed when the text can have
   * changed (a locale switch) and never as a side effect of a density change.
   */
  let labelDelta = $state(0);

  /** Dependency key for label text. The delta itself is read from the DOM. */
  function labelsKey(sortKey: SortKey, dirs: Partial<Record<SortKey, boolean>>): string {
    return `${sortKey}:${JSON.stringify(dirs)}`;
  }

  function measureDelta(): void {
    const seg = shownEl?.querySelector('[role=tablist]');
    if (!seg) return;
    // Clone the tablist and force the *opposite* label shape, laid out in normal flow.
    const other = seg.cloneNode(true) as HTMLElement;
    const wantLabels = !showLabels;
    for (const span of other.querySelectorAll('span')) {
      // Icon-only variant has no label spans; labelled variant has one per tab.
      if (wantLabels) continue;
      span.remove();
    }
    if (wantLabels) {
      for (const tab of other.querySelectorAll('[role=tab]')) {
        const label = tab.getAttribute('title') ?? '';
        if (!label) continue;
        const span = document.createElement('span');
        span.textContent = label;
        tab.appendChild(span);
      }
    }
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;left:-99999px;top:0;width:max-content;visibility:hidden';
    probe.appendChild(other);
    document.body.appendChild(probe);
    const otherW = Math.ceil(probe.firstElementChild!.getBoundingClientRect().width);
    probe.remove();
    const thisW = Math.ceil(seg.getBoundingClientRect().width);
    const delta = otherW - thisW;
    if (delta !== labelDelta) labelDelta = delta;
  }

  // Refresh the delta when label text can change, not when showLabels flips.
  // A density change is a consequence of the measurement and must not re-trigger it.
  $effect(() => {
    void labelsKey(sortKey, dirs);
    void document.documentElement.lang;
    if (shownEl) measureDelta();
  });

  $effect(() => {
    if (!shownEl) return;
    const w = Math.ceil(shownEl.getBoundingClientRect().width);
    onWidths?.({ shown: w, shownIsLabelled: showLabels, labelDelta });
  });
</script>

<div class="shrink-0">
  <div bind:this={shownEl}>
    <SortTabs {sortKey} {dirs} {onChange} {onReshuffle} hideLabel={!showLabels} />
  </div>
</div>
