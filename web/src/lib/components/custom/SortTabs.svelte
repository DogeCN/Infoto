<script lang="ts">
  // 响应式排序胶囊（spec: "自定义组件清单" / "主页面"）。三项分段选择器：
  // 最新 / 最热 / 随机；当前项图标与文字随状态差分；宽度不足时隐藏文本仅留图标，
  // 以原生 title 提供名称（契约要求不使用 DropdownMenu 降级）。
  import {
    ArrowDownWideNarrow,
    ArrowUpWideNarrow,
    Flame,
    Snowflake,
    Shuffle,
  } from '@lucide/svelte';
  import { cn } from '$lib/utils';

  export type SortKey = 'latest' | 'hottest' | 'random';

  interface Props {
    sortKey?: SortKey;
    /** 最新↔最旧、最热↔最冷 的方向。 */
    sortAsc?: boolean;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
  }

  let { sortKey = 'latest', sortAsc = false, onChange, onReshuffle }: Props = $props();

  const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'latest', label: '最新' },
    { key: 'hottest', label: '最热' },
    { key: 'random', label: '随机' },
  ];

  function iconFor(key: SortKey, asc: boolean) {
    if (key === 'latest') return asc ? ArrowUpWideNarrow : ArrowDownWideNarrow;
    if (key === 'hottest') return asc ? Snowflake : Flame;
    return Shuffle;
  }

  function labelFor(key: SortKey, asc: boolean): string {
    if (key === 'latest') return asc ? '最旧' : '最新';
    if (key === 'hottest') return asc ? '最冷' : '最热';
    return '随机';
  }

  function pick(key: SortKey) {
    // 随机项：每次单击都重新打乱
    if (key === 'random' && key === sortKey) {
      onReshuffle?.();
      return;
    }
    onChange?.(key);
  }
</script>

<div class="flex items-center gap-0.5 rounded-full border border-border bg-card/60 p-0.5">
  {#each SORTS as s (s.key)}
    {@const active = s.key === sortKey}
    {@const Icon = iconFor(s.key, active ? sortAsc : false)}
    {@const label = labelFor(s.key, active ? sortAsc : false)}
    <button
      type="button"
      class={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
      title={label}
      onclick={() => pick(s.key)}
    >
      <Icon class="size-3.5" />
      <span class="hidden sm:inline">{label}</span>
    </button>
  {/each}
</div>
