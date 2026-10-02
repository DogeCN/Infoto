<script lang="ts">
  // Sync button with rAF-driven spin and pending-count badge. The spin is rAF-driven (not
  // animate-spin): when syncing stops the icon completes the current turn instead of stopping
  // mid-rotation. A manual sync with zero pending ops enters the spin state as well.
  import { RefreshCw } from '@lucide/svelte';
  import Tooltip from './Tooltip.svelte';
  import { copy } from '$lib/i18n.svelte';
  import { fmt } from '$shared/copy';
  import { motionEase, motionMs } from '$base/lib/motion';

  interface Props {
    pendingCount?: number;
    isSyncing?: boolean;
    onSync?: () => void;
  }

  let { pendingCount = 0, isSyncing = false, onSync }: Props = $props();

  let iconEl = $state<HTMLElement | undefined>(undefined);
  let angle = 0;
  let lastT: number | undefined;

  /** One frame of slack before the transition is dropped, so the turn is never cut short. */
  const FRAME_MS = 32;

  $effect(() => {
    if (!iconEl) return;
    if (isSyncing) {
      // Keep spinning from the current angle, roughly one turn per second.
      let raf = 0;
      const tick = (t: number) => {
        const dt = lastT === undefined ? 0 : t - lastT;
        lastT = t;
        angle += dt * 0.36;
        iconEl!.style.transition = '';
        iconEl!.style.transform = `rotate(${angle}deg)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    // Stop: finish the current 360-degree turn (or start another), ease out.
    const mod = ((angle % 360) + 360) % 360;
    const target = angle + (mod === 0 ? 360 : 360 - mod);
    const settleMs = motionMs('duration-enter');
    iconEl.style.transition = `transform ${settleMs}ms ${motionEase('enter')}`;
    iconEl.style.transform = `rotate(${target}deg)`;
    // Clear the transition once the turn lands, plus one frame of slack.
    const timer = setTimeout(() => {
      angle = target % 360;
      lastT = undefined;
      if (iconEl) iconEl.style.transition = '';
    }, settleMs + FRAME_MS);
    return () => clearTimeout(timer);
  });
</script>

<Tooltip text={copy.sync.button}>
  <button
    type="button"
    aria-label={pendingCount > 0
      ? fmt(copy.sync.pendingCount, { count: pendingCount })
      : copy.sync.button}
    aria-busy={isSyncing}
    class="icon-button relative p-2 {isSyncing ? 'text-primary' : ''}"
    onclick={onSync}
  >
    <span bind:this={iconEl} class="inline-flex will-change-transform">
      <RefreshCw class="size-[var(--bar-icon)]" />
    </span>
    {#if pendingCount > 0}
      <span
        class="absolute -right-0.5 -top-0.5 flex size-[var(--bar-badge)] items-center justify-center rounded-full bg-primary px-1 text-[var(--bar-badge-text)] font-bold text-primary-foreground"
      >
        {pendingCount > 99 ? '99+' : pendingCount}
      </span>
    {/if}
  </button>
</Tooltip>
