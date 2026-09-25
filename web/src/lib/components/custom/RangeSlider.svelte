<script lang="ts">
  // 归一化双柄范围滑块（spec: "自定义组件清单 RangeSlider" / "筛选板块 范围"）。
  //
  // 架构：内部状态 tLo/tHi 是 [0,1] 的高精度浮点，指针移动只改归一化位置，
  // 与业务值域（-1~1 的热度，或 0~数千万的字节数）完全解耦——任意值域下
  // 拖动都同样平滑，不经过整数业务值的台阶。
  //
  // 三条约束：
  // 1. 只在「映射值」变化时对外说话：业务值 = round(min + t·span)。亚单位的
  //    归一化抖动既不触发 onChange（筛选/瀑布流不会在一次拖动里重排上百次），
  //    气泡也只在某柄的映射值真正变化（或键盘聚焦）时浮现，平时整行无气泡。
  // 2. 两柄不重叠 + 最小间距：归一化域的 gap 取「视觉不重叠
  //    （(柄径+呼吸间距)/行程像素宽）」与「业务上至少相差 1（1/span）」的
  //    较大者；钳制只作用于归一化位置，不反推业务值。
  // 3. 拖动路径零 transition（填充条/柄），否则快速拖动视觉跟不上。
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import { cn } from "$lib/utils";

  interface Props {
    min: number;
    max: number;
    value: [number, number];
    /** 处于完整区间（未生效）时视觉回落 muted（此处无常驻数值，仅作语义预留）。 */
    active?: boolean;
    disabled?: boolean;
    /** 值 → 显示文本（如字节数转人类可读）。 */
    format?: (v: number) => string;
    onChange?: (v: [number, number]) => void;
  }

  let {
    min,
    max,
    value,
    active = false,
    disabled = false,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  /** 柄直径（px），与模板里的 size-[18px] 一致；行程换算与几何定位都用它。 */
  const THUMB = 18;
  /** 两柄相触后再留的视觉呼吸间距（px）。 */
  const BREATHE = 4;
  /** Caret half-extent (8px square rotated 45° → 5.7px circumradius); the tip
   *  never sits closer than this to either bubble corner. */
  const TIP_PAD = 6;

  type Which = "lo" | "hi";

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  let span = $derived(Math.max(1, max - min));
  /** 归一化 → 业务值。 */
  const mapValue = (t: number): number => Math.round(min + t * span);

  // ---- 归一化内部状态（拖动期间的唯一高精度真值） ----------------------------
  // 初始位置刻意只从 props 捕获一次，后续由下面的受控同步 $effect 维护。
  // svelte-ignore state_referenced_locally
  let tLo = $state(clamp01((value[0] - min) / span));
  // svelte-ignore state_referenced_locally
  let tHi = $state(clamp01((value[1] - min) / span));
  let loVal = $derived(mapValue(tLo));
  let hiVal = $derived(mapValue(tHi));

  // 外部受控值回流：只在内部映射值与 props 不一致时同步（拖动期间 props 是
  // 自己刚 emit 的同值，不会回弹；重置筛选/外部改值则正确吸附到新位置）。
  $effect(() => {
    void value;
    void min;
    void max;
    const s = Math.max(1, max - min);
    if (mapValue(tLo) !== value[0]) tLo = clamp01((value[0] - min) / s);
    if (mapValue(tHi) !== value[1]) tHi = clamp01((value[1] - min) / s);
  });

  // ---- 几何测量：ResizeObserver 维护轨道宽；按下时再缓存一份 rect -----------
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let trackWidth = $state(0);
  const usablePx = $derived(Math.max(1, trackWidth - THUMB));
  /** 归一化域最小间距：视觉不重叠与业务差 1 取大。 */
  const minGap = $derived(Math.max((THUMB + BREATHE) / usablePx, 1 / span));

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

  /**
   * 拇指中心在轨道上的实际位置。原生行程是 [THUMB/2, 100% - THUMB/2]
   * （usable = width - THUMB），与按下换算是同一公式；填充条两端也用它，
   * 三者严格同轴。
   */
  function thumbCenter(t: number): string {
    const pct = t * 100;
    return `calc(${THUMB / 2}px + ${pct}% - ${t * THUMB}px)`;
  }
  /**
   * Bubble geometry in px, measured against the live track width and the
   * bubble's own rendered width.
   *
   * The caret is the bubble's only pointing anchor, so it must stay on the
   * thumb centre: near the ends the body stops at the track edge and the caret
   * slides along the bottom edge instead of leaving the thumb behind.
   */
  function bubblePos(t: number, bw: number): { left: number; tip: number } {
    const w = trackWidth;
    const center = THUMB / 2 + t * Math.max(0, w - THUMB);
    if (!w || !bw) return { left: center - bw / 2, tip: bw / 2 };
    const left = Math.min(Math.max(center - bw / 2, 0), Math.max(0, w - bw));
    const tip = Math.min(Math.max(center - left, TIP_PAD), Math.max(TIP_PAD, bw - TIP_PAD));
    return { left, tip };
  }

  // ---- 指针交互（轨道 + 两柄统一处理，rect 在按下时缓存） --------------------
  let drag = $state<Which | null>(null);
  /** 悬停在哪一柄上（气泡在悬停/按下/拖动/键盘聚焦任一状态下都显示）。 */
  let hover = $state<Which | null>(null);
  /** Rendered bubble widths (text length varies with the value). */
  let bwLo = $state(0);
  let bwHi = $state(0);
  let dragRect: DOMRect | null = null;

  function tFromClientX(clientX: number): number {
    if (!dragRect) return 0;
    const usable = Math.max(1, dragRect.width - THUMB);
    return clamp01((clientX - dragRect.left - THUMB / 2) / usable);
  }

  /** 钳制到 [0,1] 与最小间距后写入归一化位置；映射值真的变了才 emit。 */
  function applyT(which: Which, t: number): void {
    const next = clamp01(t);
    if (which === "lo") tLo = Math.min(next, tHi - minGap);
    else tHi = Math.max(next, tLo + minGap);

    // 四舍五入极端边界的兜底：保证业务值至少相差 1（调整的那柄让位）。
    let lo = mapValue(tLo);
    let hi = mapValue(tHi);
    if (lo >= hi) {
      if (which === "lo") lo = hi - 1;
      else hi = lo + 1;
    }
    lo = Math.min(Math.round(max), Math.max(Math.round(min), lo));
    hi = Math.min(Math.round(max), Math.max(Math.round(min), hi));

    // 只在映射值真的变化时 emit：亚单位抖动不触发上层重算（瀑布流重排是卡顿根源）
    if (lo !== value[0] || hi !== value[1]) onChange?.([lo, hi]);
  }

  function onPointerDown(e: PointerEvent): void {
    if (disabled) return;
    if (!trackEl) return;
    const hit = (e.target as HTMLElement).closest?.(
      "[data-thumb]",
    ) as HTMLElement | null;
    dragRect = trackEl.getBoundingClientRect();
    trackWidth = dragRect.width;

    let which: Which;
    if (hit?.dataset.thumb === "lo" || hit?.dataset.thumb === "hi") {
      // 按在柄上：不跳变，等 move 再走
      which = hit.dataset.thumb as Which;
    } else {
      // 点在轨道：选最近柄并立即吸附到点击点
      const t = tFromClientX(e.clientX);
      which = t - tLo <= tHi - t ? "lo" : "hi";
      applyT(which, t);
    }
    drag = which;
    trackEl.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    applyT(drag, tFromClientX(e.clientX));
  }

  function endDrag(): void {
    drag = null;
    dragRect = null;
  }

  // ---- 键盘（柄是 role=slider 的自定义元素） --------------------------------
  let focus = $state<Which | null>(null);
  function onKeydown(e: KeyboardEvent, which: Which): void {
    if (disabled) return;
    const unit = 1 / span;
    let target: number | null = null;
    const cur = which === "lo" ? tLo : tHi;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        target = cur - unit;
        break;
      case "ArrowRight":
      case "ArrowUp":
        target = cur + unit;
        break;
      case "PageDown":
        target = cur - 0.1;
        break;
      case "PageUp":
        target = cur + 0.1;
        break;
      case "Home":
        target = which === "lo" ? 0 : tLo + minGap;
        break;
      case "End":
        target = which === "hi" ? 1 : tHi - minGap;
        break;
    }
    if (target === null) return;
    e.preventDefault();
    applyT(which, target);
  }

  /**
   * 柄：18px 主色圆点 + 3px 背景色描边（在卡片上呈"打孔"感，设计稿原样）。
   * 不给阴影；悬停放大 1.1、拖动放大 1.22 且拖动期间关掉 transition（跟手优先）。
   */
  const thumbCls = cn(
    "absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full outline-none",
    "border-[3px] border-background bg-primary",
    "transition-transform duration-[120ms] ease-out active:cursor-grabbing",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  );

  const bubbleCls =
    "pointer-events-none relative whitespace-nowrap rounded-md bg-surface-top px-2.5 py-[3px] text-[11px] font-semibold tabular-nums text-foreground shadow-md";
  const caretCls =
    "absolute top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-top";
</script>

<!-- 静止时整行只有轨道（h-8 命中区）；气泡在拖动/键盘聚焦期间浮在轨道上方，
     不占布局、不推挤相邻行。 -->
<div class={cn("relative h-8 select-none", disabled && "opacity-50")}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    class={cn(
      "absolute inset-x-0 top-0 h-8 touch-none",
      disabled ? "cursor-default" : "cursor-pointer",
    )}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <!-- 底轨 -->
    <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"></div>
    <!-- 两柄之间的高亮填充（端点用拇指中心坐标，与柄严格同轴） -->
    <div
      class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
      style="left: {thumbCenter(tLo)}; right: calc(100% - {thumbCenter(tHi)})"
    ></div>

    <!-- 气泡：仅被拖动且映射值已变 / 键盘聚焦的那一个柄显示 -->
    {#if drag === "lo" || hover === "lo" || focus === "lo"}
      {@const bs = bubblePos(tLo, bwLo)}
      <div
        data-bubble
        class="pointer-events-none absolute z-30"
        style="left: {bs.left}px; bottom: calc(100% - 2px)"
      >
        <div
          bind:clientWidth={bwLo}
          class={bubbleCls}
          transition:fly={{ y: 3, duration: 140, easing: cubicOut }}
        >
          {format(loVal)}
          <span class={caretCls} style="left: {bs.tip}px"></span>
        </div>
      </div>
    {/if}
    {#if drag === "hi" || hover === "hi" || focus === "hi"}
      {@const bs = bubblePos(tHi, bwHi)}
      <div
        data-bubble
        class="pointer-events-none absolute z-30"
        style="left: {bs.left}px; bottom: calc(100% - 2px)"
      >
        <div
          bind:clientWidth={bwHi}
          class={bubbleCls}
          transition:fly={{ y: 3, duration: 140, easing: cubicOut }}
        >
          {format(hiVal)}
          <span class={caretCls} style="left: {bs.tip}px"></span>
        </div>
      </div>
    {/if}

    <!-- 下限柄 -->
    <div
      data-thumb="lo"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label="范围下限"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={loVal}
      aria-disabled={disabled}
      class={cn(
        thumbCls,
        drag === "lo" ? "z-20 scale-[1.22] transition-none" : "z-10 hover:scale-110",
      )}
      style="left: {thumbCenter(tLo)}"
      onkeydown={(e) => onKeydown(e, "lo")}
      onpointerenter={() => (hover = "lo")}
      onpointerleave={() => (hover === "lo" && (hover = null))}
      onfocus={() => (focus = "lo")}
      onblur={() => (focus = null)}
    ></div>

    <!-- 上限柄 -->
    <div
      data-thumb="hi"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label="范围上限"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={hiVal}
      aria-disabled={disabled}
      class={cn(
        thumbCls,
        drag === "hi" ? "z-20 scale-[1.22] transition-none" : "z-10 hover:scale-110",
      )}
      style="left: {thumbCenter(tHi)}"
      onkeydown={(e) => onKeydown(e, "hi")}
      onpointerenter={() => (hover = "hi")}
      onpointerleave={() => (hover === "hi" && (hover = null))}
      onfocus={() => (focus = "hi")}
      onblur={() => (focus = null)}
    ></div>
  </div>
</div>
