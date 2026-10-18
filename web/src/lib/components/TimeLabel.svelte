<script lang="ts">
  import { getLocale } from '$lib/i18n.svelte';
  import { formatRelativeTime, formatSmartAbsolute } from '$base/lib/format';
  import { clockNow, holdClock } from '$base/lib/clock.svelte';
  import SwapLabel from './SwapLabel.svelte';

  interface Props {
    /** Epoch millis of the moment to render. */
    time: number;
    /** Which edge the text hugs, so a right-aligned row stays flush right. */
    align?: 'start' | 'end';
    class?: string;
  }

  let { time, align = 'start', class: className = '' }: Props = $props();

  // Every label shares one 30-second tick; the last unmount stops it.
  $effect(() => holdClock());
  let now = $derived(clockNow());

  let relativeLabel = $derived(formatRelativeTime(time, now, getLocale()));
  let absoluteLabel = $derived(formatSmartAbsolute(time, now, getLocale()));
</script>

<!-- Relative time at rest, the absolute moment on hover; the absolute reading is the
     accessible name, since that is the one that cannot go stale. -->
<SwapLabel
  label={relativeLabel}
  alt={absoluteLabel}
  ariaLabel={absoluteLabel}
  {align}
  class={className}
/>
