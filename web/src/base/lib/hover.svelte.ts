/**
 * Hover intent: entering applies immediately, leaving waits.
 *
 * Without the delay a pointer that crosses a control's padded hit area reads as a flicker;
 * with it on both edges the control feels sluggish. Shared by every hover-revealed surface.
 *
 * The state is a rune, so a caller reads `hovered` directly in its template. A plain
 * closure cannot work here: Svelte tracks the reads it can see, and a value behind
 * `hovered()` is opaque to it, so the template would never learn the pointer moved.
 */

/** Milliseconds a pointer may sit outside before the hover state is dropped. */
export const LEAVE_DELAY_MS = 160;

export interface HoverIntent {
  readonly hovered: boolean;
  enter: () => void;
  leave: () => void;
  destroy: () => void;
}

export function createHoverIntent(): HoverIntent {
  let hovered = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  return {
    get hovered() {
      return hovered;
    },
    enter(): void {
      clear();
      hovered = true;
    },
    leave(): void {
      clear();
      timer = setTimeout(() => {
        hovered = false;
        clear();
      }, LEAVE_DELAY_MS);
    },
    destroy: clear,
  };
}
