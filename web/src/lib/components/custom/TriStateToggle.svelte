<script lang="ts">
  // 三态图标开关（spec: "自定义组件清单" / "筛选板块 归属"）：
  // 未启用 → 仅含（主题青）→ 仅不含（橙）→ 未启用。
  import type { Component } from 'svelte';
  import { cn } from '$lib/utils';
  import type { TriState } from '../../../settings';

  interface Props {
    label: string;
    icon: Component;
    state?: TriState;
    onCycle?: () => void;
  }

  let { label, icon: Icon, state = 'off', onCycle }: Props = $props();

  const STATE_CLASS: Record<TriState, string> = {
    off: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    only: 'bg-primary text-primary-foreground',
    exclude: 'bg-[#f59e0b] text-white',
  };
</script>

<button
  type="button"
  class={cn(
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
    STATE_CLASS[state]
  )}
  title={label}
  aria-pressed={state !== 'off'}
  onclick={onCycle}
>
  <Icon class="size-3.5" />
  <span class="truncate">{label}</span>
</button>
