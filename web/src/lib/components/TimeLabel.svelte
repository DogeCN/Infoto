<script lang="ts">
  import { getLocale } from '$lib/i18n.svelte';
  import { formatRelativeTime, formatSmartAbsolute } from '$base/lib/format';
  import SwapLabel from './SwapLabel.svelte';

  interface Props {
    /** Epoch millis of the moment to render. */
    time: number;
    /** Which edge the text hugs, so a right-aligned row stays flush right. */
    align?: 'start' | 'end';
    class?: string;
  }

  let { time, align = 'start', class: className = '' }: Props = $props();

  // Refresh relative timestamps every 30 seconds.
  let now = $state(Date.now());
  $effect(() => {
    void time;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

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
