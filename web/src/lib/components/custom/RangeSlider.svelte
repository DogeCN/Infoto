<script lang="ts">
  // Normalized dual-thumb range slider. Internal tLo/tHi are high-precision
  // floats in [0,1], decoupled from the business range (heat -1..1, bytes
  // 0..tens of millions). A log scale keeps byte-size dragging usable across
  // orders of magnitude.
  //
  // Rules:
  // 1. Emit only when a mapped value changes (round, or exp/round for log),
  //    so one drag never triggers hundreds of upstream recomputes. Bubbles
  //    appear only while dragging / hovering / focus is on a thumb.
  // 2. Thumbs keep a minimum visual gap; business values are post-adjusted
  //    to differ by at least one.
  // 3. Zero transition on the drag path (fill and thumbs).
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import { cn } from "$lib/utils";
  import {
    normalizeRangeValue,
    mapRangeValue,
    type RangeScale,
  } from "./rangeScale";

  type SliderScale = "linear" | "log";

  interface Props {
    min: number;
    max: number;
    value: [number, number];
    /** Log scale is used for byte sizes (linear is the default). */
    scale?: SliderScale;
    /** Reserved: muted look when the value equals the full range. */
    active?: boolean;
    disabled?: boolean;
    /** Value -> display text (e.g. bytes to human-readable). */
    format?: (v: number) => string;
    onChange?: (v: [number, number]) => void;
  }

  let {
    min,
    max,
    value,
    scale = "linear",
    active = false,
    disabled = false,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  /** Thumb diameter (px), matching size-[18px] in the template. */
  const THUMB = 18;
  /** Visual breathing gap when the two thumb edges touch (px). */
  const BREATHE = 4;
  /** Caret half-extent (8px square rotated 45° -> 5.7px circumradius); the
   *  tip never sits closer than this to either bubble corner. */
  const TIP_PAD = 6;

  type Which = "lo" | "hi";

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  let span = $derived(Math.max(1, max - min));

  /** Business value -> normalized position under the active scale. */
  let scaleMode = $derived<RangeScale>(scale === "log" ? "logarithmic" : "linear");

  const tFromValue = (v: number): number => normalizeRangeValue(v, min, max, scaleMode);
  /** Normalized position -> business value under the active scale. */
  const mapValue = (t: number): number => mapRangeValue(t, min, max, scaleMode);

  // ---- normalized internal state (high-precision truth while dragging) ------
  // Captured from props once; the controlled-sync effect below maintains it.
  // svelte-ignore state_referenced_locally
  let tLo = $state(tFromValue(value[0]));
  // svelte-ignore state_referenced_locally
  let tHi = $state(tFromValue(value[1]));
  let loVal = $derived(mapValue(tLo));
  let hiVal = $derived(mapValue(tHi));

  // External controlled values flow back only when the mapped values differ
  // from props (during a drag props are the values just emitted; resets and
  // outside changes snap correctly).
  $effect(() => {
    void value;
    void min;
    void max;
    void scale;
    if (mapValue(tLo) !== value[0]) tLo = tFromValue(value[0]);
    if (mapValue(tHi) !== value[1]) tHi = tFromValue(value[1]);
  });

  // ---- geometry: ResizeObserver maintains the track width ---------------
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let trackWidth = $state(0);
  const usablePx = $derived(Math.max(1, trackWidth - THUMB));
  /** Minimum normalized gap for visual non-overlap; the business ≥1 rule is
   *  enforced by the post-adjustment in applyT. */
  const minGap = $derived((THUMB + BREATHE) / usablePx);

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

  /** Thumb centre position. The native travel range is [THUMB/2, 100% -
   *  THUMB/2] (usable = width - THUMB), the same formula for press mapping
   *  and the fill endpoints, so all three stay coaxial. */
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
    const tip = Math.min(
      Math.max(center - left, TIP_PAD),
      Math.max(TIP_PAD, bw - TIP_PAD),
    );
    return { left, tip };
  }

  // ---- pointer interaction (track and thumbs; rect cached on press) --------
  let drag = $state<Which | null>(null);
  /** Thumb currently hovered (bubbles show on hover / press / drag / focus). */
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

  /** Clamp to [0,1] with the minimum gap, then emit only on a real value
   *  change. */
  function applyT(which: Which, t: number): void {
    const next = clamp01(t);
    if (which === "lo") tLo = Math.min(next, tHi - minGap);
    else tHi = Math.max(next, tLo + minGap);

    // Boundary fallback: business values must differ by at least one, and the
    // adjusted thumb gives way.
    let lo = mapValue(tLo);
    let hi = mapValue(tHi);
    if (lo >= hi) {
      if (which === "lo") lo = hi - 1;
      else hi = lo + 1;
    }
    lo = Math.min(Math.round(max), Math.max(Math.round(min), lo));
    hi = Math.min(Math.round(max), Math.max(Math.round(min), hi));

    // Emit only on a real mapped value change: sub-unit jitter never triggers
    // an upstream recompute (waterfall reflows are the freeze source).
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
      // Pressing a thumb: no jump, movement drives it.
      which = hit.dataset.thumb as Which;
    } else {
      // Pressing the track: pick the nearer thumb and snap to the press point.
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

  // ---- keyboard (thumbs are custom role=slider elements) --------------------
  let focus = $state<Which | null>(null);
  function onKeydown(e: KeyboardEvent, which: Which): void {
    if (disabled) return;
    const curV = which === "lo" ? loVal : hiVal;
    // One business-unit step at the current position under the active scale.
    const unit = Math.abs(tFromValue(curV + 1) - tFromValue(curV));
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

  /** Thumb: 18px primary dot with a 3px background border ("punched into
   *  the card", per the design spec). No shadow; hover scales 1.1, drag 1.22
   *  with transitions off while dragging. */
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

<!-- At rest only the track is visible (h-8 hit area); bubbles float above
     the track during drag / focus without affecting layout. -->
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
    <div
      class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"
    ></div>
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
        drag === "lo"
          ? "z-20 scale-[1.22] transition-none"
          : "z-10 hover:scale-110",
      )}
      style="left: {thumbCenter(tLo)}"
      onkeydown={(e) => onKeydown(e, "lo")}
      onpointerenter={() => (hover = "lo")}
      onpointerleave={() => hover === "lo" && (hover = null)}
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
        drag === "hi"
          ? "z-20 scale-[1.22] transition-none"
          : "z-10 hover:scale-110",
      )}
      style="left: {thumbCenter(tHi)}"
      onkeydown={(e) => onKeydown(e, "hi")}
      onpointerenter={() => (hover = "hi")}
      onpointerleave={() => hover === "hi" && (hover = null)}
      onfocus={() => (focus = "hi")}
      onblur={() => (focus = null)}
    ></div>
  </div>
</div>
