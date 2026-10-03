<script lang="ts">
  // Step-aligned single-thumb slider with pointer and keyboard controls and change-only emissions.
  import type { Component } from 'svelte';
  import { cn } from '$base/lib/ui';
  import {
    bubblePosition,
    thumbCenter,
    pointerPosition,
    sliderKeyTarget,
    stepValue,
  } from '$base/lib/slider';
  import { clamp01 } from '$base/lib/num';
  import SliderBubble from './SliderBubble.svelte';
  import { copy } from '$lib/i18n.svelte';

  interface Props {
    min: number;
    max: number;
    step?: number;
    value: number;
    /** Default value: when equal outside a drag, icon and value fall back to muted (same rule as the range sliders). */
    defaultValue: number;
    /** Leading icon of the row. */
    icon: Component;
    /** Value → display text. */
    format?: (v: number) => string;
    onChange?: (v: number) => void;
    onDragChange?: (dragging: boolean) => void;
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
    onDragChange,
  }: Props = $props();

  let span = $derived(Math.max(1, max - min));
  // `drag` is declared before `active` because the derived reads it: a live drag must keep
  // the row highlighted even when the value passes back through the default mid-gesture.
  let drag = $state(false);
  let active = $derived(value !== defaultValue || drag);

  /** Normalized position → business value (aligned to step). */
  const mapValue = (t: number): number => stepValue(t, min, max, step);

  // svelte-ignore state_referenced_locally
  let t = $state(clamp01((value - min) / span));
  let curVal = $derived(mapValue(t));

  // Reconcile external values while preserving continuous thumb travel during dragging.
  $effect(() => {
    void value;
    void min;
    void max;
    if (mapValue(t) !== value) t = clamp01((value - min) / Math.max(1, max - min));
  });

  /** No numeric column on the right: values only appear in the drag bubble, so the row
   *  is just "icon + track", structurally identical to the filter panel's dual-handle row. */

  // ---- geometry: ResizeObserver keeps the track width; rect is re-cached on press ----
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let trackWidth = $state(0);

  const bubblePos = (position: number, width: number) =>
    bubblePosition(position, width, trackWidth);

  // ---- pointer interaction -------------------------------------------------
  /** Hovering the handle (the bubble shows on hover / press / drag / keyboard focus alike). */
  let hover = $state(false);
  /** Rendered bubble width (text length varies with the value). */
  let bw = $state(0);
  let dragRect: DOMRect | null = null;

  function tFromClientX(clientX: number): number {
    return dragRect ? pointerPosition(clientX, dragRect) : 0;
  }

  function applyT(next: number): void {
    t = clamp01(next);
    const v = mapValue(t);
    // Emit only when the mapped value really changes: sub-unit jitter never triggers an upstream recompute (waterfall reflow is the jank source)
    if (v !== value) onChange?.(v);
  }

  function onPointerDown(e: PointerEvent): void {
    if (!trackEl || e.button !== 0) return;
    dragRect = trackEl.getBoundingClientRect();
    trackWidth = dragRect.width;
    drag = true;
    onDragChange?.(true);
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
    if (!drag) return;
    drag = false;
    dragRect = null;
    onDragChange?.(false);
  }

  // ---- keyboard (the handle is a custom role=slider element) ----------------
  let focus = $state(false);
  function onKeydown(e: KeyboardEvent): void {
    const target = sliderKeyTarget(e.key, t, step > 0 ? step / span : 1 / span);
    if (target === null) return;
    e.preventDefault();
    applyT(target);
  }

  const iconCls = $derived(
    cn(
      'size-4 shrink-0 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)]',
      active ? 'text-primary' : 'text-muted-foreground',
    ),
  );
</script>

<!-- Two columns: icon + track (values only show in the bubble) -->
<div class="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2">
  <Icon class={iconCls} />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    bind:clientWidth={trackWidth}
    class="relative h-8 min-w-0 cursor-pointer touch-none select-none"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
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
      <SliderBubble position={bubblePos(t, bw)} text={format(curVal)} bind:width={bw} />
    {/if}

    <div
      data-thumb="single"
      role="slider"
      tabindex="0"
      aria-label={copy.settings.sliderValue}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={curVal}
      aria-valuetext={format(curVal)}
      class={cn(
        'slider-thumb',
        drag ? 'z-20 scale-[1.22] transition-none' : 'z-10 hover:scale-110',
      )}
      style="left: {thumbCenter(t)}"
      onkeydown={onKeydown}
      onpointerenter={() => (hover = true)}
      onpointerleave={() => (hover = false)}
      onfocus={() => (focus = true)}
      onblur={() => (focus = false)}
    ></div>
  </div>
</div>
