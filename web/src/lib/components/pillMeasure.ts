/**
 * Density contract for a segmented pill: the width of the shape on screen plus the widths
 * of all three label shapes, so the top bar can resolve a three-level density (all labels
 * → current-item label → icons only) from one measurement.
 *
 * Every shape width is measured by cloning the tablist into normal flow, never by reading
 * the on-screen label spans. A hidden label copy resolves its width against a containing
 * block that is not its own, and `invisible` can be overridden by a descendant — so summing
 * those widths under-reports and drifts with padding and borders. Cloning also keeps the
 * probe out of the header, where an `absolute` twin would become the containing block for
 * the paged track and drag both screens off-screen.
 */

export interface PillWidths {
  /** Width of the variant currently on screen. */
  shown: number;
  /** Every item labelled. */
  labelled: number;
  /** Only the active item labelled, every other item icon-only. */
  current: number;
  /** Every item icon-only. */
  icon: number;
}

/** Which tabs of a clone keep their label spans. */
type LabelShape = 'all' | 'active' | 'none';

/**
 * Lay a clone out off-screen in normal flow with the requested label shape, and report width.
 *
 * Labels are always stripped and then rebuilt from `data-label`. The compact on-screen
 * shape hides its spans instead of removing them (`absolute invisible`), so "spans exist"
 * cannot mean "already labelled" — and an early return there would leave the hidden copies
 * in the clone, measuring the icon width as the labelled width and flapping the bar's
 * density at the collapse threshold.
 *
 * The label text rides `data-label`, never `title`: the tabs' tooltips are the custom
 * component now, and a measurement must not read a tooltip's attribute to work.
 */
function widthOfShape(tablist: HTMLElement, shape: LabelShape): number {
  const clone = tablist.cloneNode(true) as HTMLElement;
  for (const span of clone.querySelectorAll('[role="tab"] > span')) span.remove();
  if (shape !== 'none') {
    for (const tab of clone.querySelectorAll('[role="tab"]')) {
      const keepsLabel = shape === 'all' || tab.getAttribute('aria-selected') === 'true';
      const label = tab.getAttribute('data-label');
      if (!keepsLabel || !label) continue;
      const span = document.createElement('span');
      span.textContent = label;
      tab.appendChild(span);
    }
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;width:max-content;visibility:hidden';
  probe.appendChild(clone);
  document.body.appendChild(probe);
  const width = Math.ceil(clone.getBoundingClientRect().width);
  probe.remove();
  return width;
}

/** Inputs of the action; the caller builds one object from its own reactive state. */
interface PillMeasureOptions {
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
    current.onWidths({
      shown,
      labelled: widthOfShape(tablist, 'all'),
      current: widthOfShape(tablist, 'active'),
      icon: widthOfShape(tablist, 'none'),
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
