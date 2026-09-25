<script lang="ts">
  // 同步按钮（spec: "自定义组件清单"）——旋转动画 + 计数角标。
  // 旋转由 rAF 驱动（不用 animate-spin）：同步结束时从当前角度补齐到整圈
  // 再停，不会戛然而止；pending 为 0 的手动同步同样进入旋转态。
  import { RefreshCw } from '@lucide/svelte';

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
      // 继续旋转：从当前角度起步，约 1 圈/秒
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
    // 停止：补齐到 360° 整圈（若恰好已整圈则再走一圈），缓出收尾
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

<button
  type="button"
  class="relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-card hover:text-foreground {isSyncing
    ? 'text-primary'
    : ''}"
  onclick={onSync}
  title="同步"
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
