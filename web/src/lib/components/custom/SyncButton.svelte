<script lang="ts">
  // 同步按钮（spec: "自定义组件清单"）——旋转动画 + Badge 计数角标。
  import { RefreshCw } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  interface Props {
    pendingCount?: number;
    isSyncing?: boolean;
    onSync?: () => void;
  }

  let { pendingCount = 0, isSyncing = false, onSync }: Props = $props();
</script>

<button
  type="button"
  class={cn(
    'relative flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground',
    isSyncing && 'text-primary'
  )}
  onclick={onSync}
  title="同步"
>
  <RefreshCw class="size-5 {isSyncing ? 'animate-spin' : ''}" />
  {#if pendingCount > 0}
    <span
      class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
    >
      {pendingCount > 99 ? '99+' : pendingCount}
    </span>
  {/if}
</button>
