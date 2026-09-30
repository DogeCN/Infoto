interface OverlayOptions {
  enabled?: boolean;
  onClose: () => void;
}

const layers: HTMLElement[] = [];
let bodyOverflow = '';

/** Trap focus in the topmost overlay, lock scrolling, and restore the trigger on close. */
export function overlay(node: HTMLElement, options: OverlayOptions) {
  let previousFocus: HTMLElement | null = null;
  let active = false;
  let frame = 0;

  const isTop = () => layers.at(-1) === node;
  const focusable = () =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [tabindex], [contenteditable="true"]',
      ),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert]') &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden',
    );

  function focusFirst() {
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? node).focus({
      preventScroll: true,
    });
  }

  function onFocus(event: FocusEvent) {
    if (isTop() && !node.contains(event.target as Node)) focusFirst();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!isTop()) return;
    if (event.key === 'Escape') {
      // Native popovers dismiss before the enclosing overlay.
      if (node.querySelector(':popover-open')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      options.onClose();
    } else if (event.key === 'Tab') {
      const elements = focusable();
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (
        !elements.length ||
        index < 0 ||
        (event.shiftKey ? index === 0 : index === elements.length - 1)
      ) {
        event.preventDefault();
        (event.shiftKey ? (elements.at(-1) ?? node) : (elements[0] ?? node)).focus({
          preventScroll: true,
        });
      }
    }
  }

  function activate() {
    if (active) return;
    active = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!layers.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    layers.push(node);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocus);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (active && isTop()) focusFirst();
      });
    });
  }

  function deactivate() {
    if (!active) return;
    const wasTop = isTop();
    active = false;
    cancelAnimationFrame(frame);
    layers.splice(layers.indexOf(node), 1);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocus);
    if (!layers.length) document.body.style.overflow = bodyOverflow;
    if (wasTop && previousFocus?.isConnected && !previousFocus.closest('[inert]')) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  if (options.enabled !== false) activate();
  return {
    update(next: OverlayOptions) {
      options = next;
      if (options.enabled === false) deactivate();
      else activate();
    },
    destroy: deactivate,
  };
}
