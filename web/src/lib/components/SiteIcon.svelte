<script lang="ts">
  // The Infoto site mark, rendered as an inline SVG so it can be recoloured and sized
  // without a network request. Used for the card-level media-failure glyph instead of the
  // animated GlitchText, which is too loud for an empty card.
  import { cn } from '$base/lib/ui';

  let {
    class: className = '',
    size = 40,
    color = 'currentColor',
  }: {
    class?: string;
    /** A pixel number, or any CSS length (`min(56px, 12cqmin)`) for a surface that sizes
     *  the mark from its own container instead of a breakpoint or a JS measurement. */
    size?: number | string;
    color?: string;
  } = $props();
  let length = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={cn('block', className)}
  style="width: {length}; height: {length}"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="10" />
  <line x1="14.31" y1="8" x2="20.05" y2="17.94" />
  <line x1="9.69" y1="8" x2="21.17" y2="8" />
  <line x1="7.38" y1="12" x2="13.12" y2="2.06" />
  <line x1="9.69" y1="16" x2="3.95" y2="6.06" />
  <line x1="14.31" y1="16" x2="2.83" y2="16" />
  <line x1="16.62" y1="12" x2="10.88" y2="21.94" />
</svg>
