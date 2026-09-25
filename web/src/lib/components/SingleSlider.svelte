<script lang="ts">
  // 单柄滑块（布局区「目标带宽 / 间距」）。与 RangeSlider（筛选区双柄）共用同一套
  // 视觉与交互语言 —— 都是真实 DOM 柄 + 指针事件，不再用原生 input[type=range]
  // （其 thumb 伪元素在 Firefox 上既拖不动也画不出来，还要双份引擎特判）。
  //
  // 同样采用归一化内部状态：指针移动只改 [0,1] 的浮点位置，按 step 对齐后**仅当
  // 映射值变化才 emit** —— 拖动一次不会让上层重算几十上百次（瀑布流重排是卡顿根源）。
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { cn } from '$lib/utils';

  interface Props {
    min: number;
    max: number;
    step?: number;
    value: number;
    /** 默认值：与之相等时图标与数值回落 muted（与筛选范围滑块同规则）。 */
    defaultValue: number;
    /** 行首图标。 */
    icon: Component;
    /** 值 → 显示文本。 */
    format?: (v: number) => string;
    onChange?: (v: number) => void;
  }

  let {
    min,
    max,
    step = 1,
    value,
    defaultValue,
    icon: Icon,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  /** 柄直径（px），与模板里的 size-[18px] 一致；行程换算与几何定位都用它。 */
  const THUMB = 18;
  /** Caret half-extent (8px square rotated 45° → 5.7px circumradius); the tip
   *  never sits closer than this to either bubble corner. */
  const TIP_PAD = 6;

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  let span = $derived(Math.max(1, max - min));
  let active = $derived(value !== defaultValue);

  /** 归一化 → 业务值（按 step 对齐）。 */
  const mapValue = (t: number): number => {
    const raw = min + t * span;
    const aligned = step > 0 ? Math.round(raw / step) * step : raw;
    return Math.min(max, Math.max(min, Number(aligned.toFixed(6))));
  };

  // svelte-ignore state_referenced_locally
  let t = $state(clamp01((value - min) / span));
  let curVal = $derived(mapValue(t));

  // 外部受控值回流：只在映射值与 props 不一致时同步（拖动期间 props 是自己刚 emit
  // 的同值，不会回弹；重置/外部改值则正确吸附）。
  $effect(() => {
    void value;
    void min;
    void max;
    if (mapValue(t) !== value) t = clamp01((value - min) / Math.max(1, max - min));
  });

  /**
   * 数值列已取消（右侧数值文本不要了）——数值只走拖动气泡。
   * 因此不再需要 labelCols：整行就是「图标 + 轨道」，与筛选区双柄行完全同构。
   */

  // ---- 几何：ResizeObserver 维护轨道宽；按下时再缓存一份 rect ------------------
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let trackWidth = $state(0);

  onMount(() => {
    if (!trackEl) return;
    const update = (): void => {
      trackWidth = trackEl!.getBoundingClientRect().width;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(trackEl);
    return () => ro.disconnect();
  });

  /** 拇指中心在轨道上的位置（与 RangeSlider 同一公式，填充端点严格同轴）。 */
  function thumbCenter(n: number): string {
    return `calc(${THUMB / 2}px + ${n * 100}% - ${n * THUMB}px)`;
  }
  /**
   * Bubble geometry in px, measured against the live track width and the
   * bubble's own rendered width.
   *
   * The caret is the bubble's only pointing anchor, so it must stay on the
   * thumb centre: near the ends the body stops at the track edge and the caret
   * slides along the bottom edge instead of leaving the thumb behind.
   */
  function bubblePos(n: number, bw: number): { left: number; tip: number } {
    const w = trackWidth;
    const center = THUMB / 2 + n * Math.max(0, w - THUMB);
    if (!w || !bw) return { left: center - bw / 2, tip: bw / 2 };
    const left = Math.min(Math.max(center - bw / 2, 0), Math.max(0, w - bw));
    const tip = Math.min(Math.max(center - left, TIP_PAD), Math.max(TIP_PAD, bw - TIP_PAD));
    return { left, tip };
  }

  // ---- 指针交互 --------------------------------------------------------------
  let drag = $state(false);
  /** 悬停在柄上（气泡在悬停/按下/拖动/键盘聚焦任一状态下都显示）。 */
  let hover = $state(false);
  /** Rendered bubble width (text length varies with the value). */
  let bw = $state(0);
  let dragRect: DOMRect | null = null;

  function tFromClientX(clientX: number): number {
    if (!dragRect) return 0;
    const usable = Math.max(1, dragRect.width - THUMB);
    return clamp01((clientX - dragRect.left - THUMB / 2) / usable);
  }

  function applyT(next: number): void {
    t = clamp01(next);
    const v = mapValue(t);
    // 只在映射值真的变化时 emit：亚单位抖动不触发上层重算（瀑布流重排是卡顿根源）
    if (v !== value) onChange?.(v);
  }

  function onPointerDown(e: PointerEvent): void {
    if (!trackEl) return;
    dragRect = trackEl.getBoundingClientRect();
    trackWidth = dragRect.width;
    drag = true;
    trackEl.setPointerCapture?.(e.pointerId);
    // 点轨道即吸附到点击点（拉到底部也不会跳变，公式与拖动一致）
    if (!(e.target as HTMLElement).closest?.('[data-thumb]')) applyT(tFromClientX(e.clientX));
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    applyT(tFromClientX(e.clientX));
  }

  function endDrag(): void {
    drag = false;
    dragRect = null;
  }

  // ---- 键盘（柄是 role=slider 的自定义元素） ---------------------------------
  let focus = $state(false);
  function onKeydown(e: KeyboardEvent): void {
    const unit = step > 0 ? step / span : 1 / span;
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        target = t - unit;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        target = t + unit;
        break;
      case 'PageDown':
        target = t - unit * 10;
        break;
      case 'PageUp':
        target = t + unit * 10;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = 1;
        break;
    }
    if (target === null) return;
    e.preventDefault();
    applyT(target);
  }

  const thumbCls = cn(
    'absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full outline-none',
    'border-[3px] border-background bg-primary',
    'transition-transform duration-[120ms] ease-out active:cursor-grabbing',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  );
  const bubbleCls =
    'pointer-events-none relative whitespace-nowrap rounded-md bg-surface-top px-2.5 py-[3px] text-[11px] font-semibold tabular-nums text-foreground shadow-md';
  const caretCls =
    'absolute top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-top';

  const iconCls = $derived(
    cn(
      'size-4 shrink-0 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
      active ? 'text-primary' : 'text-muted-foreground',
    ),
  );
</script>

<!-- 图标 + 轨道两列（右侧数值文本已取消，数值只走气泡） -->
<div class="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2">
  <Icon class={iconCls} />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    class="relative h-8 min-w-0 cursor-pointer touch-none select-none"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <!-- 底轨 -->
    <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"></div>
    <!-- 已选区间填充 -->
    <div
      class="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
      style="right: calc(100% - {thumbCenter(t)})"
    ></div>

    <!-- 气泡：拖动且映射值已变 / 键盘聚焦时浮出 -->
    {#if drag || hover || focus}
      {@const bs = bubblePos(t, bw)}
      <div
        data-bubble
        class="pointer-events-none absolute z-30"
        style="left: {bs.left}px; bottom: calc(100% - 2px)"
      >
        <div
          bind:clientWidth={bw}
          class={bubbleCls}
          transition:fly={{ y: 3, duration: 140, easing: cubicOut }}
        >
          {format(curVal)}
          <span class={caretCls} style="left: {bs.tip}px"></span>
        </div>
      </div>
    {/if}

    <div
      data-thumb="single"
      role="slider"
      tabindex="0"
      aria-label="数值"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={curVal}
      class={cn(thumbCls, drag ? 'z-20 scale-[1.22] transition-none' : 'z-10 hover:scale-110')}
      style="left: {thumbCenter(t)}"
      onkeydown={onKeydown}
      onpointerenter={() => (hover = true)}
      onpointerleave={() => (hover = false)}
      onfocus={() => (focus = true)}
      onblur={() => (focus = false)}
    ></div>
  </div>
</div>
