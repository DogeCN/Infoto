<script lang="ts">
  // The sort pill, in whichever density the top bar chose.
  //
  // ⚠️ Why the hidden variant is NOT also rendered here — this is the third attempt at
  // this measurement, and the first two were wrong in ways only a real browser exposed:
  //
  //  1. `invisible absolute` (out of flow but laid out) reports a width constrained by
  //     its containing block, not its content. Measured: the labelled variant read
  //     215px that way against a true 258px, because `absolute` shrink-to-fit resolves
  //     against the shrink-0 parent's box. Every threshold built on it was ~42px out.
  //  2. Keeping both wrappers inside a `relative shrink-0` parent made the *same* slot
  //     change width when the mode flipped (257 → 215), so the measurement fed back
  //     into the very decision that changed it — a feedback loop that made the bar flap
  //     between `full` and `compact` around 470px however the thresholds were tuned.
  //
  // The lesson: a hidden element's box is not its content width, and measuring one is
  // not a neutral read — it can couple to the decision it feeds. So exactly one variant
  // is rendered and measured live; the other is derived from a label delta measured in
  // normal flow, once, and only when the label text can have changed.
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

  /** Label text in sort order — the only thing the delta depends on. */
  function labelsKey(sortKey: SortKey, dirs: Partial<Record<SortKey, boolean>>): string {
    // readLabel is not exported; the rendered label is the button's text, so read it
    // from the DOM when the delta is measured instead of re-deriving it here.
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

  // Re-measure the delta when the label text can have changed, NOT when showLabels
  // flips: flipping the mode is a consequence of the measurement, and letting it
  // re-trigger the measurement is the feedback loop that made the bar flap.
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
