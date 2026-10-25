<script lang="ts">
  // One piece: a Tooltip wrapped around an icon button. The tooltip text and the
  // button's accessible name are usually the same string, so the wrapper takes it
  // once; `ariaLabel` overrides for the sites where the spoken name is longer.
  import type { Snippet } from 'svelte';
  import { cn } from '$base/lib/ui';
  import Tooltip from './Tooltip.svelte';

  interface Props {
    /** Tooltip text and (by default) the button's aria-label. */
    text: string;
    /** Overrides the aria-label when the spoken name differs from the tooltip. */
    ariaLabel?: string;
    /** The click handler, receiving the event so a control inside a clickable surface can
     *  stop it there (a card's Retry must not also open the card). */
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    /** The bar's lit-icon treatment. */
    active?: boolean;
    /** The destructive icon-button variant. */
    danger?: boolean;
    /** Toggle buttons publish their state, rather than relying on a native `title`. */
    ariaPressed?: boolean;
    /** ID of the popover this button opens, instead of an `onclick` handler. */
    popoverTarget?: string;
    /** Receives the button element, for callers that anchor something to it. */
    bindElement?: (el: HTMLButtonElement) => void;
    /** Overlay focus trap focuses this control on open (see `base/lib/overlay.ts`). */
    autofocus?: boolean;
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Extra button classes (padding, size, colour tail). */
    class?: string;
    children: Snippet;
  }

  let {
    text,
    ariaLabel,
    onclick,
    disabled = false,
    active = false,
    danger = false,
    ariaPressed,
    popoverTarget,
    bindElement,
    autofocus = false,
    side = 'top',
    class: className = '',
    children,
  }: Props = $props();

  /** The button element, for the caller and for the tooltip's own trigger lookup. */
  function mount(node: HTMLButtonElement) {
    bindElement?.(node);
    return { destroy: () => {} };
  }
</script>

<Tooltip {text} {side}>
  <button
    type="button"
    use:mount
    data-autofocus={autofocus ? '' : undefined}
    class={cn('icon-button', danger && 'icon-button--danger', active && 'text-primary', className)}
    aria-label={ariaLabel ?? text}
    aria-pressed={ariaPressed}
    popovertarget={popoverTarget}
    {disabled}
    {onclick}
  >
    {@render children()}
  </button>
</Tooltip>
