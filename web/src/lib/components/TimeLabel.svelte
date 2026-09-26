<script lang="ts">
  import { onDestroy } from 'svelte';
  import { formatRelativeTime, formatSmartAbsolute } from '$lib/time';

  interface Props {
    /** Epoch millis of the moment to render. */
    time: number;
    /** Which edge the text hugs, so a right-aligned row stays flush right. */
    align?: 'start' | 'end';
    class?: string;
  }

  let { time, align = 'start', class: className = '' }: Props = $props();

  // Tick so the relative label ("just now / N minutes ago") advances without a reload;
  // 30s is finer than the smallest unit ever shown, so the label never looks stale.
  let now = $state(Date.now());
  $effect(() => {
    void time;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  // Hover is JS-driven rather than `:hover` so leaving is debounced: the label sits
  // beside other controls, so a pointer wobbling across its edge would flip the swap
  // rapidly. Enter is instant; leave waits LEAVE_DELAY_MS, cancelled by a re-enter.
  const LEAVE_DELAY_MS = 160;
  let hovered = $state(false);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;

  function onEnter(): void {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = undefined;
    }
    hovered = true;
  }
  function onLeave(): void {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      hovered = false;
      leaveTimer = undefined;
    }, LEAVE_DELAY_MS);
  }
  onDestroy(() => {
    if (leaveTimer) clearTimeout(leaveTimer);
  });

  let relativeLabel = $derived(formatRelativeTime(time, now));
  let absoluteLabel = $derived(formatSmartAbsolute(time, now));
</script>

<!-- Relative by default; hover slides it out to the left as the precise time slides in
     from the right. Both live in one grid cell, so the row never reflows on hover;
     `aria-label` always carries the precise time. -->
<!-- role=presentation: this wrapper is a hit-area only, not content. -->
<span
  class="time-hit {className}"
  role="presentation"
  onpointerenter={onEnter}
  onpointerleave={onLeave}
>
  <span
    class="time-label"
    data-align={align}
    data-hovered={hovered ? 'true' : 'false'}
    aria-label={absoluteLabel}
  >
    <span class="time-label__rel">{relativeLabel}</span>
    <span class="time-label__abs" aria-hidden="true">{absoluteLabel}</span>
  </span>
</span>

<style>
  /* Wrapper only exists to own the expanded hit area: the pseudo can't live on
     .time-label because overflow: hidden would clip it. */
  .time-hit {
    position: relative;
    display: inline-block;
  }
  .time-hit::before {
    content: '';
    position: absolute;
    inset: -8px -12px;
  }
  .time-label {
    display: inline-grid;
    overflow: hidden;
    white-space: nowrap;
  }
  .time-label > * {
    grid-area: 1 / 1;
    transition:
      transform var(--duration-exit) var(--ease-exit),
      opacity var(--duration-exit) var(--ease-exit);
  }
  .time-label[data-align='start'] > * {
    justify-self: start;
  }
  .time-label[data-align='end'] > * {
    justify-self: end;
  }
  .time-label__abs {
    opacity: 0;
    transform: translateX(70%);
  }
  /* Enter slower than exit (the project's asymmetric timing discipline). */
  .time-label[data-hovered='true'] .time-label__rel {
    opacity: 0;
    transform: translateX(-70%);
    transition-duration: var(--duration-enter);
    transition-timing-function: var(--ease-enter);
  }
  .time-label[data-hovered='true'] .time-label__abs {
    opacity: 1;
    transform: translateX(0);
    transition-duration: var(--duration-enter);
    transition-timing-function: var(--ease-enter);
  }
  @media (prefers-reduced-motion: reduce) {
    .time-label > * {
      transition: none;
    }
  }
</style>
