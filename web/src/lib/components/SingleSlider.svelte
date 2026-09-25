<script lang="ts">
  // Single-handle slider (layout panel: target bandwidth / gap), sharing RangeSlider's visual and
  // interaction language — a real DOM handle with pointer events, no native input[type=range] (its
  // thumb can't be dragged or drawn in Firefox). Normalized [0,1] state, step-aligned: it emits only when the mapped value changes, so one drag can't flood upstream recomputes (waterfall reflow is the jank source).
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
    /** Default value: when equal, icon and value fall back to muted (same rule as the range sliders). */
    defaultValue: number;
    /** Leading icon of the row. */
    icon: Component;
    /** Value → display text. */
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

  /** Handle diameter (px), matching size-[18px] in the template; used for travel and placement. */
  const THUMB = 18;
  /** Caret half-extent (8px square rotated 45° → 5.7px circumradius); the tip
   *  never sits closer than this to either bubble corner. */
  const TIP_PAD = 6;

  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  let span = $derived(Math.max(1, max - min));
  let active = $derived(value !== defaultValue);

  /** Normalized position → business value (aligned to step). */
  const mapValue = (t: number): number => {
    const raw = min + t * span;
    const aligned = step > 0 ? Math.round(raw / step) * step : raw;
    return Math.min(max, Math.max(min, Number(aligned.toFixed(6))));
  };

  // svelte-ignore state_referenced_locally
  let t = $state(clamp01((value - min) / span));
  let curVal = $derived(mapValue(t));

  // External controlled values flow back only when the mapped value differs from props
  // (during a drag the props are the value just emitted, so it can't snap back; resets
  // and outside changes still snap correctly).
  $effect(() => {
    void value;
    void min;
    void max;
    if (mapValue(t) !== value) t = clamp01((value - min) / Math.max(1, max - min));
  });

  /**
   * The numeric column was dropped (no right-hand value text): values only appear in the
   * drag bubble, so labelCols is unnecessary — the row is just "icon + track", structurally
   * identical to the filter panel's dual-handle row.
   */

  // ---- geometry: ResizeObserver keeps the track width; rect is re-cached on press ----
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

  /** Thumb centre position on the track (same formula as RangeSlider, fill ends stay coaxial). */
  function thumbCenter(n: number): string {
    return `calc(${THUMB / 2}px + ${n * 100}% - ${n * THUMB}px)`;
  }
  /**
   * Bubble geometry in px, measured against the live track width and the bubble's own
   * rendered width. The caret is the bubble's only pointing anchor, so it must stay on the
   * thumb centre: near the ends the body stops at the track edge and the caret slides along it.
   */
  function bubblePos(n: number, bw: number): { left: number; tip: number } {
    const w = trackWidth;
    const center = THUMB / 2 + n * Math.max(0, w - THUMB);
    if (!w || !bw) return { left: center - bw / 2, tip: bw / 2 };
    const left = Math.min(Math.max(center - bw / 2, 0), Math.max(0, w - bw));
    const tip = Math.min(Math.max(center - left, TIP_PAD), Math.max(TIP_PAD, bw - TIP_PAD));
    return { left, tip };
  }

  // ---- pointer interaction -------------------------------------------------
  let drag = $state(false);
  /** Hovering the handle (the bubble shows on hover / press / drag / keyboard focus alike). */
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
    // Emit only when the mapped value really changes: sub-unit jitter never triggers an upstream recompute (waterfall reflow is the jank source)
    if (v !== value) onChange?.(v);
  }

  function onPointerDown(e: PointerEvent): void {
    if (!trackEl) return;
    dragRect = trackEl.getBoundingClientRect();
    trackWidth = dragRect.width;
    drag = true;
    trackEl.setPointerCapture?.(e.pointerId);
    // Clicking the track snaps to that point (no jump when dragging to the end; same formula as dragging)
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

  // ---- keyboard (the handle is a custom role=slider element) ----------------
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

<!-- Two columns: icon + track (the right-hand value text was dropped; values only show in the bubble) -->
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
    <!-- base track -->
    <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"></div>
    <!-- selected range fill -->
    <div
      class="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
      style="right: calc(100% - {thumbCenter(t)})"
    ></div>

    <!-- Bubble: surfaces while dragging, hovering, or keyboard-focused -->
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
