<script lang="ts">
  // 响应式排序胶囊（spec: "自定义组件清单" / "主页面"）。三项分段选择器：
  // 最新 / 最热 / 随机；当前项图标与文字随状态差分；宽度不足时隐藏文本仅留图标，
  // 以原生 title 提供名称（契约要求不使用 DropdownMenu 降级）。
  // 激活指示为滑动 pill：切换项时底色胶囊平滑平移到当前项。
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

  function pick(key: SortKey) {
    // 随机项：每次单击都重新打乱
    if (key === 'random' && key === sortKey) {
      onReshuffle?.();
      return;
    }
    onChange?.(key);
  }

  // 滑动指示器：跟踪当前项按钮的几何位置
  // 用 action 记录元素（bind:this 绑到普通对象属性在 Svelte 5 会告警 binding_property_non_reactive）
  const btnEls: Partial<Record<SortKey, HTMLButtonElement>> = {};
  let indicator = $state({ x: 0, w: 0, ready: true });

  function track(el: HTMLButtonElement, key: SortKey) {
    btnEls[key] = el;
    syncIndicator(key);
    return {
      destroy() {
        delete btnEls[key];
      },
    };
  }

  function syncIndicator(key: SortKey) {
    const el = btnEls[key];
    if (el) indicator = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }

  $effect(() => {
    // 依赖 sortKey：切换时把指示器滑到当前项
    syncIndicator(sortKey);
  });

  // 文本随断点隐藏会改变按钮宽度，resize 时重算
  $effect(() => {
    const onResize = () => syncIndicator(sortKey);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
</script>

<div class="relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1">
  <!-- 滑动指示 pill -->
  <div
    class="pointer-events-none absolute bottom-1 top-1 rounded-full bg-primary transition-[transform,width,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:opacity-0={!indicator.ready}
    style="width: {indicator.w}px; transform: translateX({indicator.x}px)"
  ></div>
  {#each SORTS as s (s.key)}
    {@const active = s.key === sortKey}
    {@const asc = dirs[s.key] ?? false}
    {@const Icon = iconFor(s.key, asc)}
    {@const label = labelFor(s.key, asc)}
    <button
      use:track={s.key}
      type="button"
      class={cn(
        'relative z-10 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
        active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      title={label}
      onclick={() => pick(s.key)}
    >
      <Icon class="size-4" />
      <span class="hidden sm:inline">{label}</span>
    </button>
  {/each}
</div>
