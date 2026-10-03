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
    onclick?: () => void;
    disabled?: boolean;
    /** The bar's lit-icon treatment. */
    active?: boolean;
    /** The destructive icon-button variant. */
    danger?: boolean;
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
    side = 'top',
    class: className = '',
    children,
  }: Props = $props();
</script>

<Tooltip {text} {side}>
  <button
    type="button"
    class={cn('icon-button', danger && 'icon-button--danger', active && 'text-primary', className)}
    aria-label={ariaLabel ?? text}
    {disabled}
    {onclick}
  >
    {@render children()}
  </button>
</Tooltip>
