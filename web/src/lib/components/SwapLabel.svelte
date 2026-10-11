<script lang="ts">
  // Two strings stacked in one grid cell, swapping on hover: the resting text slides out and
  // the alternate slides in. Width-stable, because both labels occupy the same cell.
  //
  // Extracted from TimeLabel so every "one value, a second reading on hover" label reads the
  // same — the timestamp (relative → absolute) and the sidebar's version (tag → commit hash).
  import { onDestroy } from 'svelte';
  import { createHoverIntent } from '$base/lib/hover.svelte';

  interface Props {
    /** The text at rest. */
    label: string;
    /** The text revealed on hover. */
    alt: string;
    /** Accessible name for the pair; the alternate span is hidden from the tree. */
    ariaLabel?: string;
    /** Which edge the text hugs, so a right-aligned row stays flush right. */
    align?: 'start' | 'end';
    class?: string;
  }

  let { label, alt, ariaLabel, align = 'start', class: className = '' }: Props = $props();

  // Show the alternate immediately on hover; debounce pointer leave.
  const intent = createHoverIntent();
  onDestroy(intent.destroy);
</script>

<!-- role=presentation: this wrapper is a hit-area only, not content. -->
<span
  class="swap-hit {className}"
  role="presentation"
  onpointerenter={intent.enter}
  onpointerleave={intent.leave}
>
  <span
    class="swap-label"
    data-align={align}
    data-hovered={intent.hovered ? 'true' : 'false'}
    aria-label={ariaLabel}
  >
    <span class="swap-label__rest">{label}</span>
    <span class="swap-label__alt" aria-hidden="true">{alt}</span>
  </span>
</span>

<style>
  /* Wrapper only exists to own the expanded hit area: the pseudo can't live on
     .swap-label because overflow: hidden would clip it. */
  .swap-hit {
    position: relative;
    display: inline-block;
  }
  .swap-hit::before {
    content: '';
    position: absolute;
    inset: -8px -12px;
  }
  .swap-label {
    display: inline-grid;
    overflow: hidden;
    white-space: nowrap;
  }
  .swap-label > * {
    grid-area: 1 / 1;
    transition:
      transform var(--duration-exit) var(--ease-exit),
      opacity var(--duration-exit) var(--ease-exit);
  }
  .swap-label[data-align='start'] > * {
    justify-self: start;
  }
  .swap-label[data-align='end'] > * {
    justify-self: end;
  }
  .swap-label__alt {
    opacity: 0;
    transform: translateX(70%);
  }
  /* Enter slower than exit (the project's asymmetric timing discipline). */
  .swap-label[data-hovered='true'] .swap-label__rest {
    opacity: 0;
    transform: translateX(-70%);
    transition-duration: var(--duration-enter);
    transition-timing-function: var(--ease-enter);
  }
  .swap-label[data-hovered='true'] .swap-label__alt {
    opacity: 1;
    transform: translateX(0);
    transition-duration: var(--duration-enter);
    transition-timing-function: var(--ease-enter);
  }
  @media (prefers-reduced-motion: reduce) {
    .swap-label > * {
      transition: none;
    }
  }
</style>
