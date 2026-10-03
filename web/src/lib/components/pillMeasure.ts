/**
 * Density contract for a segmented pill: how wide the pill is now, and how much wider it
 * would be with the other label shape.
 *
 * The delta is measured by cloning the tablist into normal flow with the opposite label
 * shape, never by reading the on-screen label spans. A hidden label copy resolves its width
 * against a containing block that is not its own, and `invisible` can be overridden by a
 * descendant — so summing those widths under-reports and drifts with padding and borders.
 * Cloning also keeps the probe out of the header, where an `absolute` twin would become the
 * containing block for the paged track and drag both screens off-screen.
 */

export interface PillWidths {
  /** Width of the variant currently on screen. */
  shown: number;
  /** Whether that on-screen variant is the labelled one. */
  shownIsLabelled: boolean;
  /** `labelled - iconOnly`: add it to reach the labelled variant, subtract for the other. */
  labelDelta: number;
}

/** Re-shape a cloned tablist into `labelled`, removing or restoring the label spans. */
function forceLabels(clone: HTMLElement, labelled: boolean): void {
  // Always strip every span first, then rebuild from the title attributes. The compact
  // on-screen shape hides its spans instead of removing them (`absolute invisible`), so
  // "spans exist" cannot mean "already labelled" — and an early return there would leave
  // the hidden copies in the clone, measuring the icon width as the labelled width and
  // flapping the bar's density at the collapse threshold.
  for (const span of clone.querySelectorAll('[role="tab"] > span')) span.remove();
  if (!labelled) return;
  for (const tab of clone.querySelectorAll('[role="tab"]')) {
    const label = tab.getAttribute('title');
    if (!label) continue;
    const span = document.createElement('span');
    span.textContent = label;
    tab.appendChild(span);
  }
}

/** Lay a clone out off-screen in normal flow and report its width. */
function widthOfLabelledShape(tablist: HTMLElement, labelled: boolean): number {
  const clone = tablist.cloneNode(true) as HTMLElement;
  forceLabels(clone, labelled);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;width:max-content;visibility:hidden';
  probe.appendChild(clone);
  document.body.appendChild(probe);
  const width = Math.ceil(clone.getBoundingClientRect().width);
  probe.remove();
  return width;
}

export interface PillMeasureOptions {
  /** Whether the pill on screen is showing labels. */
  labelled: boolean;
  /** Values that change the labels or shape; a change re-measures. */
  deps?: unknown;
  onWidths: (widths: PillWidths) => void;
}

/**
 * Report a pill's density contract, re-measuring on resize and whenever `deps` changes.
 * The returned object is a Svelte action handle: `destroy` disconnects the observer.
 */
export function measurePillWidths(
  node: HTMLElement,
  options: PillMeasureOptions,
): { update: (next: PillMeasureOptions) => void; destroy: () => void } {
  let current = options;
  let frame = 0;

  function measure(): void {
    const tablist: HTMLElement | null = node.matches('[role="tablist"]')
      ? node
      : node.querySelector<HTMLElement>('[role="tablist"]');
    if (!tablist) return;
    const shown = Math.ceil(tablist.getBoundingClientRect().width);
    if (!shown) return;
    const other = widthOfLabelledShape(tablist, !current.labelled);
    current.onWidths({
      shown,
      shownIsLabelled: current.labelled,
      labelDelta: other - shown,
    });
  }

  /** Coalesce to one measurement per frame so a resize burst measures once. */
  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(node);

  schedule();

  return {
    update(next: PillMeasureOptions): void {
      current = next;
      schedule();
    },
    destroy(): void {
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };
}
