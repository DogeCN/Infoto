<script lang="ts">
  // 响应式排序胶囊（spec: "自定义组件清单" / "主页面"）。三项分段选择器：
  // 最新 / 最热 / 随机；当前项图标与文字随状态差分；宽度不足时隐藏文本仅留图标，
  // 以原生 title 提供名称（契约要求不使用 DropdownMenu 降级）。
  // 视觉与滑动 pill 动画统一由 SegmentedControl 提供，本组件只负责领域逻辑
  // （每项各自记住的方向、随机项重排）。
  import {
    ArrowDownWideNarrow,
    ArrowUpWideNarrow,
    Flame,
    Snowflake,
    Shuffle,
  } from '@lucide/svelte';
  import SegmentedControl from '$lib/components/SegmentedControl.svelte';
  import type { SegmentedItem } from '$lib/components/SegmentedControl.svelte';

  export type SortKey = 'latest' | 'hottest' | 'random';

  interface Props {
    sortKey?: SortKey;
    /**
     * 每个排序项**各自记住**的方向（最新↔最旧、最热↔最冷）。
     * 不能只传当前项的方向——那样切走后未激活项会回落默认文案，
     * 只有切回来的瞬间才跳成真实方向（视觉割裂）。
     */
    dirs?: Partial<Record<SortKey, boolean>>;
    onChange?: (key: SortKey) => void;
    onReshuffle?: () => void;
  }

  let { sortKey = 'latest', dirs = {}, onChange, onReshuffle }: Props = $props();

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

  // 标签/图标随 dirs 差分，喂给通用胶囊。
  const items = $derived<ReadonlyArray<SegmentedItem<SortKey>>>(
    SORTS.map((s) => {
      const asc = dirs[s.key] ?? false;
      return { value: s.key, label: labelFor(s.key, asc), icon: iconFor(s.key, asc) };
    }),
  );
</script>

<SegmentedControl
  {items}
  value={sortKey}
  responsiveHideLabel
  ariaLabel="排序方式"
  onChange={(k) => onChange?.(k)}
  onReselect={(k) => {
    if (k === 'random') {
      // 随机项：再次单击 = 重新打乱（原 24b1bf2 pick 的短路分支）
      onReshuffle?.();
    } else {
      // 最新/最热：再次单击 = 反向（最新↔最旧 / 最热↔最冷）。
      // 原版把"激活项再点"继续走 onChange，由父级 onSortChange 在
      // key===sortKey 分支翻转方向；重构漏掉这条路径，导致单击不可切向。
      onChange?.(k);
    }
  }}
/>
