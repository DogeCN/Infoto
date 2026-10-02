<script lang="ts">
  // Dual-thumb slider with linear or logarithmic mapping, separated handles, and change-only emissions.
  import { fly } from 'svelte/transition';
  import { cn } from '$base/lib/ui';
  import {
    bubblePosition,
    thumbCenter,
    pointerPosition,
    sliderKeyTarget,
    THUMB,
    normalizeRangeValue,
    mapRangeValue,
    type RangeScale,
  } from '$base/lib/slider';
  import { clamp01 } from '$base/lib/num';
  import { bubbleTransition } from '$base/lib/motion';
  import { copy } from '$lib/i18n.svelte';

  type SliderScale = 'linear' | 'log';

  interface Props {
    min: number;
    max: number;
    value: [number, number];
    /** Log scale is used for byte sizes (linear is the default). */
    scale?: SliderScale;
    disabled?: boolean;
    /** Value -> display text (e.g. bytes to human-readable). */
    format?: (v: number) => string;
    onChange?: (v: [number, number]) => void;
  }

  let {
    min,
    max,
    value,
    scale = 'linear',
    disabled = false,
    format = (v) => String(v),
    onChange,
  }: Props = $props();

  type Which = 'lo' | 'hi';
  const BREATHE = 4;

  /** Business value -> normalized position under the active scale. */
  let scaleMode = $derived<RangeScale>(scale === 'log' ? 'logarithmic' : 'linear');

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

  // Reconcile controlled values while retaining sub-unit precision during dragging.
  $effect(() => {
    void value;
    void min;
    void max;
    void scale;
    if (Math.abs(mapValue(tLo) - value[0]) > 0.5) tLo = tFromValue(value[0]);
    if (Math.abs(mapValue(tHi) - value[1]) > 0.5) tHi = tFromValue(value[1]);
  });

  // ---- geometry: ResizeObserver maintains the track width ---------------
  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let trackWidth = $state(0);
  const usablePx = $derived(Math.max(1, trackWidth - THUMB));
  /** Minimum thumb separation in normalized track units, bounded by visual spacing and one business unit. */
  const minGap = $derived.by(() => {
    const visual = (THUMB + BREATHE) / usablePx;
    const span = max - min;
    if (span <= 0) return Math.min(1, visual);
    const unit = Math.abs(tFromValue(min + 1) - tFromValue(min));
    return Math.min(1, Math.max(visual, unit));
  });

  const bubblePos = (position: number, width: number) =>
    bubblePosition(position, width, trackWidth);

  // ---- pointer interaction (track and thumbs; rect cached on press) --------
  let drag = $state<Which | null>(null);
  /** Thumb currently hovered (bubbles show on hover / press / drag / focus). */
  let hover = $state<Which | null>(null);
  /** Rendered bubble widths (text length varies with the value). */
  let bwLo = $state(0);
  let bwHi = $state(0);
  let dragRect: DOMRect | null = null;

  function tFromClientX(clientX: number): number {
    return dragRect ? pointerPosition(clientX, dragRect) : 0;
  }

  /** Clamp to [0,1] with the minimum gap, then emit only on a real value
   *  change. */
  function applyT(which: Which, t: number): void {
    const next = clamp01(t);
    if (which === 'lo') tLo = clamp01(Math.min(next, tHi - minGap));
    else tHi = clamp01(Math.max(next, tLo + minGap));

    // Boundary fallback: business values must differ by at least one, and the
    // adjusted thumb gives way.
    let lo = mapValue(tLo);
    let hi = mapValue(tHi);
    if (lo >= hi) {
      if (which === 'lo') lo = hi - 1;
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
    if (!trackEl || e.button !== 0) return;
    const hit = (e.target as HTMLElement).closest?.('[data-thumb]') as HTMLElement | null;
    dragRect = trackEl.getBoundingClientRect();
    trackWidth = dragRect.width;

    let which: Which;
    if (hit?.dataset.thumb === 'lo' || hit?.dataset.thumb === 'hi') {
      // Pressing a thumb: no jump, movement drives it.
      which = hit.dataset.thumb as Which;
    } else {
      // Pressing the track: pick the nearer thumb and snap to the press point.
      const t = tFromClientX(e.clientX);
      which = t - tLo <= tHi - t ? 'lo' : 'hi';
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
    const curV = which === 'lo' ? loVal : hiVal;
    // One business-unit step at the current position under the active scale.
    const unit = Math.abs(tFromValue(curV + 1) - tFromValue(curV));
    const target = sliderKeyTarget(e.key, which === 'lo' ? tLo : tHi, unit, {
      home: which === 'lo' ? 0 : tLo + minGap,
      end: which === 'hi' ? 1 : tHi - minGap,
    });
    if (target === null) return;
    e.preventDefault();
    applyT(which, target);
  }
</script>

<!-- At rest only the track is visible (h-8 hit area); bubbles float above
     the track during drag / focus without affecting layout. -->
<div class={cn('relative h-8 select-none', disabled && 'opacity-50')}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={trackEl}
    bind:clientWidth={trackWidth}
    class={cn(
      'absolute inset-x-0 top-0 h-8 touch-none',
      disabled ? 'cursor-default' : 'cursor-pointer',
    )}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onlostpointercapture={endDrag}
  >
    <!-- base track -->
    <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border"></div>
    <!-- Highlight fill between the thumbs (endpoints use thumb centres, strictly coaxial with them) -->
    <div
      class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
      style="left: {thumbCenter(tLo)}; right: calc(100% - {thumbCenter(tHi)})"
    ></div>

    <!-- Bubble: shown only for the hovered / dragged thumb (mapped value changed) or the keyboard-focused one -->
    {#if drag === 'lo' || hover === 'lo' || focus === 'lo'}
      {@const bs = bubblePos(tLo, bwLo)}
      <div
        data-bubble
        class="pointer-events-none absolute z-30"
        style="left: {bs.left}px; bottom: calc(100% - 2px)"
      >
        <div bind:clientWidth={bwLo} class="slider-bubble" transition:fly={bubbleTransition}>
          {format(loVal)}
          <span class="slider-caret" style="left: {bs.tip}px"></span>
        </div>
      </div>
    {/if}
    {#if drag === 'hi' || hover === 'hi' || focus === 'hi'}
      {@const bs = bubblePos(tHi, bwHi)}
      <div
        data-bubble
        class="pointer-events-none absolute z-30"
        style="left: {bs.left}px; bottom: calc(100% - 2px)"
      >
        <div bind:clientWidth={bwHi} class="slider-bubble" transition:fly={bubbleTransition}>
          {format(hiVal)}
          <span class="slider-caret" style="left: {bs.tip}px"></span>
        </div>
      </div>
    {/if}

    <!-- lower thumb -->
    <div
      data-thumb="lo"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={copy.settings.rangeMin}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={loVal}
      aria-valuetext={format(loVal)}
      aria-disabled={disabled}
      class={cn(
        'slider-thumb',
        drag === 'lo' ? 'z-20 scale-[1.22] transition-none' : 'z-10 hover:scale-110',
      )}
      style="left: {thumbCenter(tLo)}"
      onkeydown={(e) => onKeydown(e, 'lo')}
      onpointerenter={() => (hover = 'lo')}
      onpointerleave={() => hover === 'lo' && (hover = null)}
      onfocus={() => (focus = 'lo')}
      onblur={() => (focus = null)}
    ></div>

    <!-- upper thumb -->
    <div
      data-thumb="hi"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={copy.settings.rangeMax}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={hiVal}
      aria-valuetext={format(hiVal)}
      aria-disabled={disabled}
      class={cn(
        'slider-thumb',
        drag === 'hi' ? 'z-20 scale-[1.22] transition-none' : 'z-10 hover:scale-110',
      )}
      style="left: {thumbCenter(tHi)}"
      onkeydown={(e) => onKeydown(e, 'hi')}
      onpointerenter={() => (hover = 'hi')}
      onpointerleave={() => hover === 'hi' && (hover = null)}
      onfocus={() => (focus = 'hi')}
      onblur={() => (focus = null)}
    ></div>
  </div>
</div>
