<script lang="ts">
  // Sync button with rAF-driven spin and pending-count badge. The spin is rAF-driven (not
  // animate-spin): when syncing stops the icon completes the current turn instead of stopping
  // mid-rotation. A manual sync with zero pending ops enters the spin state as well.
  import { RefreshCw } from '@lucide/svelte';
  import Tooltip from './Tooltip.svelte';
  import { copy, fmt } from '$shared/copy';

  interface Props {
    pendingCount?: number;
    isSyncing?: boolean;
    onSync?: () => void;
  }

  let { pendingCount = 0, isSyncing = false, onSync }: Props = $props();

  let iconEl = $state<HTMLElement | undefined>(undefined);
  let angle = 0;
  let lastT: number | undefined;

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
    iconEl.style.transition = 'transform 300ms var(--ease-enter)';
    iconEl.style.transform = `rotate(${target}deg)`;
    const timer = setTimeout(() => {
      angle = target % 360;
      lastT = undefined;
      if (iconEl) iconEl.style.transition = '';
    }, 320);
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
    class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground {isSyncing
      ? 'text-primary'
      : ''}"
    onclick={onSync}
  >
    <span bind:this={iconEl} class="inline-flex will-change-transform">
      <RefreshCw class="size-5" />
    </span>
    {#if pendingCount > 0}
      <span
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
      >
        {pendingCount > 99 ? '99+' : pendingCount}
      </span>
    {/if}
  </button>
</Tooltip>
