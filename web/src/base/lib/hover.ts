/**
 * Hover intent: entering applies immediately, leaving waits.
 *
 * Without the delay a pointer that crosses a control's padded hit area reads as a flicker;
 * with it on both edges the control feels sluggish. Shared by every hover-revealed surface.
 */

/** Milliseconds a pointer may sit outside before the hover state is dropped. */
export const LEAVE_DELAY_MS = 160;

/**
 * Debounced hover state. Call `enter` / `leave` from the pointer handlers and `destroy`
 * on unmount; read `hovered` as a plain boolean.
 */
export function createHoverIntent(): {
  hovered: () => boolean;
  enter: () => void;
  leave: () => void;
  destroy: () => void;
} {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    hovered: () => active,
    enter(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
      active = true;
    },
    leave(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        active = false;
        timer = undefined;
      }, LEAVE_DELAY_MS);
    },
    destroy(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
