// Pointer-resize gesture: maps a single-axis drag onto a clamped value. The returned stop
// function removes every listener, so a component owns teardown on unmount or when its
// surface closes.

export interface PointerResize {
  /** The pointerdown that starts the gesture; non-primary buttons are ignored. */
  event: PointerEvent;
  /** Axis the pointer travels along. */
  axis: 'x' | 'y';
  /** Multiplier for the pointer delta, e.g. -1 when dragging up grows a height. */
  sign?: number;
  /** Value at gesture start. */
  start: number;
  /** Clamps every candidate value before it is reported. */
  clamp: (value: number) => number;
  /** Called on each move with the clamped value. */
  onMove: (value: number) => void;
  /** Called once when the gesture begins. */
  onStart?: () => void;
  /** Called once when the gesture ends through pointerup or pointercancel. */
  onEnd?: () => void;
  /** Called whenever the listeners are removed, for either reason. */
  onStop?: () => void;
}

export function startPointerResize(options: PointerResize): () => void {
  const { event, axis, sign = 1, start, clamp, onMove, onStart, onEnd, onStop } = options;
  if (event.button !== 0) return () => {};
  event.preventDefault();
  onStart?.();

  const origin = axis === 'x' ? event.clientX : event.clientY;
  const move = (next: PointerEvent): void => {
    if (next.pointerId !== event.pointerId) return;
    const current = axis === 'x' ? next.clientX : next.clientY;
    onMove(clamp(start + (current - origin) * sign));
  };
  function end(next: PointerEvent): void {
    if (next.pointerId !== event.pointerId) return;
    onEnd?.();
    remove();
  }
  function remove(): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onStop?.();
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  return remove;
}
