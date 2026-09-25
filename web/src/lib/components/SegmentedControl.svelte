<script lang="ts" generics="T extends string = string">
  // 通用分段胶囊（主页 SortTabs 与管理页共用）：圆角外壳 + 青色滑动指示 pill。
  // 激活动画统一走 --ease-enter / --duration-enter（滑动 pill 平移），
  // 文字色过渡走 --ease-exit / --duration-exit，与主站其它控件一致。
  import type { Component } from 'svelte';
  import { cn } from '$lib/utils';

  export type SegmentedItem<T extends string = string> = {
    value: T;
    label: string;
    icon?: Component;
  };

  interface Props<T extends string = string> {
    items: ReadonlyArray<SegmentedItem<T>>;
    value?: T;
    onChange?: (value: T) => void;
    /** 再次点击已激活项时触发（如「随机」重排）。 */
    onReselect?: (value: T) => void;
    /** 窄屏隐藏文字仅留图标，图标配原生 title 提供名称。 */
    responsiveHideLabel?: boolean;
    size?: 'sm' | 'md';
    ariaLabel?: string;
  }

  let {
    items,
    value,
    onChange,
    onReselect,
    responsiveHideLabel = false,
    size = 'md',
    ariaLabel,
  }: Props<T> = $props();

  // 滑动指示器：跟踪当前项按钮的几何位置。
  // 用 action 记录元素（Svelte 5 下 bind:this 绑到普通对象属性会告警）。
  const btnEls: Partial<Record<string, HTMLButtonElement>> = {};
  let indicator = $state({ x: 0, w: 0, ready: true });

  function track(el: HTMLButtonElement, v: string) {
    btnEls[v] = el;
    syncIndicator(v);
    return {
      destroy() {
        delete btnEls[v];
      },
    };
  }

  function syncIndicator(v: string) {
    const el = btnEls[v];
    if (el) indicator = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }

  $effect(() => {
    // 依赖 value 与 items：切换项、或标签宽度随状态变化（如 最新↔最旧）时重算。
    // 两行为「触碰依赖」惯用法，副作用是让 $effect 订阅它们。
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    value;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    items;
    if (value !== undefined) syncIndicator(value);
  });

  $effect(() => {
    const onResize = () => {
      if (value !== undefined) syncIndicator(value);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  function pick(v: string) {
    if (v === value) {
      onReselect?.(v as T);
      return;
    }
    onChange?.(v as T);
  }
</script>

<div
  role="tablist"
  aria-label={ariaLabel}
  class="relative flex items-center gap-1 rounded-full border border-border bg-card/80 p-1"
>
  <!-- 滑动指示 pill：切换项时平滑平移到当前项 -->
  <div
    class="pointer-events-none absolute bottom-1 top-1 rounded-full bg-primary transition-[transform,width,opacity] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:opacity-0={!indicator.ready}
    style="width: {indicator.w}px; transform: translateX({indicator.x}px)"
  ></div>
  {#each items as item (item.value)}
    {@const active = item.value === value}
    {@const Icon = item.icon}
    <button
      use:track={item.value}
      type="button"
      role="tab"
      aria-selected={active}
      class={cn(
        'relative z-10 inline-flex items-center rounded-full py-1.5 text-sm font-medium transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
        size === 'md' ? 'px-3.5' : 'px-3',
        responsiveHideLabel ? 'gap-1.5' : 'gap-2',
        active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
      title={item.label}
      onclick={() => pick(item.value)}
    >
      {#if Icon}<Icon class="size-4" />{/if}
      <span class={cn(responsiveHideLabel && 'hidden sm:inline')}>{item.label}</span>
    </button>
  {/each}
</div>
