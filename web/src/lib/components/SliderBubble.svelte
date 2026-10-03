<script lang="ts">
  // The value bubble shared by both sliders: floats above the track and reports its
  // rendered width back, so the caller can clamp it against the viewport edges with
  // the real size instead of an estimate.
  import { fly } from 'svelte/transition';
  import { bubbleTransition } from '$base/lib/motion';

  interface Props {
    /** Pixel geometry from `bubblePosition`: wrapper left and caret tip. */
    position: { left: number; tip: number };
    text: string;
    /** Rendered bubble width, two-way bound for the caller's clamping math. */
    width?: number;
  }

  let { position, text, width = $bindable(0) }: Props = $props();
</script>

<div
  data-bubble
  class="pointer-events-none absolute z-30"
  style="left: {position.left}px; bottom: calc(100% - 2px)"
>
  <div bind:clientWidth={width} class="slider-bubble" transition:fly={bubbleTransition}>
    {text}
    <span class="slider-caret" style="left: {position.tip}px"></span>
  </div>
</div>
