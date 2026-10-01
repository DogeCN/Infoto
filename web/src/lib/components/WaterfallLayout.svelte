<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    computeLayoutChunked,
    orderByMain,
    windowIndices,
    type LayoutBox,
    type ScrollDir,
    type FillStrategy,
  } from '$base/lib/layout';
  import { marqueeHits, type Rect } from '$base/lib/marquee';
  import type { Photo } from '$shared/types';
  import PhotoCard from './PhotoCard.svelte';
  import Lightbox from './Lightbox.svelte';
  import MultiSelectBar from './MultiSelectBar.svelte';
  import { scroll } from '../../state/scroll.svelte';
  import { barHeight } from './topbarFit';

  interface Props {
    photos: Photo[];
    /** Pending upload entries (placed right after info cards, before other media; excluded from sorting/filtering). */
    pending?: Photo[];
    /** Curtain overlays for pending entries: fraction (uploading) / failed (full cover + retry). */
    overlays?: Map<number, { fraction?: number; failed?: boolean; error?: string }>;
    onRetryUpload?: (photo: Photo) => void;
    /** Dismiss a failed upload card (cancel on the pipeline + drop locally). */
    onDismissUpload?: (photo: Photo) => void;
    dir?: ScrollDir;
    strategy?: FillStrategy;
    /** Target row height / column width in CSS pixels. */
    band?: number;
    gap?: number;
    bufferScreens?: number;
    selfId?: number;
    multiMode?: boolean;
    onMultiModeChange?: (v: boolean) => void;
    // All write operations are committed upstream as ops (op-log → /sync)
    onLike?: (photo: Photo) => void;
    onDislike?: (photo: Photo) => void;
    onRequestDelete?: (photo: Photo) => void;
    /** Root users only: delete op. */
    onDelete?: (photo: Photo) => void;
    onDeleteSelected?: (ids: number[]) => void;
    onDownloadSelected?: (ids: number[]) => void;
    /** Batch unmark (undo likes / dislikes / delete requests all at once). */
    onUnmarkSelected?: (ids: number[]) => void;
    /** Single-photo download (Lightbox swipe-down gesture). */
    onDownload?: (photo: Photo) => void;
  }

  let {
    photos,
    pending = [],
    overlays = new Map<number, { fraction?: number; failed?: boolean; error?: string }>(),
    onRetryUpload,
    onDismissUpload,
    dir = 'v',
    strategy = 'sequential',
    band = 260,
    gap = 12,
    bufferScreens = 2,
    selfId = -1,
    multiMode = $bindable(false),
    onMultiModeChange,
    onLike,
    onDislike,
    onRequestDelete,
    onDelete,
    onDeleteSelected,
    onDownloadSelected,
    onUnmarkSelected,
    onDownload,
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let scrollTop = $state(0);
  let scrollLeftPos = $state(0);
  let viewportH = $state(0);
  let containerW = $state(0);
  /** Canvas inset: the scroll container is full-width (scrollbar at the viewport edge), whitespace comes from the canvas margin. */
  let padX = $derived(Math.max(8, Math.min(16, Math.round(containerW * 0.02))));
  /** Breathing room between the bar's bottom edge and the first row. */
  const TOP_GAP = 16;
  /** Top spacing: clear the floating top bar, then breathe.
   *
   *  Derived from the bar's own height rather than guessed from a width percentage: the
   *  old `containerW * 0.08` clamped to 48–80px was an independent formula, and below
   *  ~750px it fell under the bar's actual height, so the first row sat underneath it.
   *  Both elements are full width, so the scroll container's width is the same input the
   *  bar measures and `barHeight()` yields the identical number.
   */
  let padTop = $derived(Math.ceil(barHeight(containerW) + TOP_GAP));

  // Uniform grid zoom preserves cell geometry and gap proportions.
  let zoom = $state(1);
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;

  function applyZoom(factor: number): void {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  }

  /** Ctrl+wheel zoom needs passive:false to block browser page zoom, hence the action binding. */
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoom * Math.exp(-e.deltaY * 0.0025));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      },
    };
  }

  // Two-finger pinch on mobile
  const pinch = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let pinchZoom = 1;

  function onPinchDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      if (!a || !b) return;
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZoom = zoom;
    }
  }

  function onPinchMove(e: PointerEvent): void {
    if (!pinch.has(e.pointerId) || pinch.size < 2) return;
    pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pinch.values()];
    if (!a || !b || pinchStart === 0) return;
    applyZoom(pinchZoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart));
  }

  function onPinchUp(e: PointerEvent): void {
    pinch.delete(e.pointerId);
    if (pinch.size < 2) pinchStart = 0;
  }

  // Layout state
  let boxes = $state<LayoutBox[]>([]);
  let totalH = $state(0);
  /** Maximum box length along the scroll axis, used as the virtualizer search bound. */
  let maxExtent = $state(0);
  let totalW = $state(0);
  let order = $state<number[]>([]);
  let layoutReady = $state(false);
  let currentAbort: AbortController | null = null;
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;

  // Selection state
  let selected = $state<Set<number>>(new Set());

  // Marquee state
  let marqueeActive = $state(false);
  let marqueeRect = $state<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  /** Selection snapshot taken when the marquee starts: onMove recomputes snapshot ∪ hits, avoiding loops from incremental writes. */
  let marqueeBase = new Set<number>();
  /** Whether marquee dragging suppresses the following card click. */
  let marqueeMoved = false;

  // Lightbox state
  let lightboxOpen = $state(false);
  let lightboxIndex = $state(0);

  // Clear the selection when leaving multi-select mode (no leftover highlight from the top bar icon)
  $effect(() => {
    if (!multiMode && selected.size > 0) selected = new Set();
  });

  // Layout items: pending entries first, the rest follow the sorted/filtered result
  let allPhotos = $derived([...pending, ...photos]);
  let layoutItems = $derived(
    allPhotos.map((p) => ({ id: p.id, w: p.width || 1, h: p.height || 1 })),
  );

  let photoMap = $derived(new Map(allPhotos.map((p) => [p.id, p])));

  const layoutKeyCache = new WeakMap<Photo[], string>();
  /** Lightbox navigation includes laid-out photos except failed uploads. */
  let lightboxPhotos = $derived(allPhotos.filter((p) => !isFailedUpload(p.id)));

  // Recompute layout when dependencies change, debounced to one run per frame.
  // State writes land in a rAF. layoutKey skips a reschedule when geometry is unchanged.
  let layoutKey = '';

  $effect(() => {
    const items = layoutItems;
    const w = containerW;
    const d = dir;
    const s = strategy;
    // Zoom is a uniform scale: the gap scales with the cells, so a 50% view is
    // genuinely the whole layout at half size rather than the same cells in a
    // tighter row.
    const g = Math.max(0, Math.round(gap * zoom));
    if (w <= 0 || items.length === 0) {
      // Cancel pending layout work when the list becomes empty.
      if (layoutTimer !== undefined) {
        clearTimeout(layoutTimer);
        layoutTimer = undefined;
      }
      currentAbort?.abort();
      layoutKey = '';
      boxes = [];
      totalH = 0;
      order = [];
      layoutReady = false;
      return;
    }
    // Column count comes from the persisted pixel band and the measured cross size.
    const cross = (d === 'v' ? w : viewportH) - (d === 'v' ? padX * 2 : padTop + padX);
    const b = Math.max(1, Math.round(band * zoom));
    let itemsKey = layoutKeyCache.get(allPhotos);
    if (!itemsKey) {
      itemsKey = items.map((i) => `${i.id}:${i.w}:${i.h}`).join(',');
      layoutKeyCache.set(allPhotos, itemsKey);
    }
    const key = `${w}|${d}|${s}|${b}|${g}|${itemsKey}`;
    if (key === layoutKey) return;
    layoutKey = key;
    // Cancel the pending debounce timer.
    if (layoutTimer !== undefined) clearTimeout(layoutTimer);
    // Abort in-flight layout computation.
    currentAbort?.abort();
    layoutTimer = setTimeout(() => {
      layoutTimer = undefined;
      const controller = new AbortController();
      currentAbort = controller;
      const opts = {
        dir: d,
        strategy: s,
        // Static cross-axis whitespace in horizontal mode: top padTop (for the floating top bar) + bottom padX
        cross,
        band: b,
        gap: g,
      };
      computeLayoutChunked(items, opts, 400, controller.signal).then((result) => {
        if (result && !controller.signal.aborted) {
          const sorted = orderByMain(result.boxes, d);
          requestAnimationFrame(() => {
            if (!controller.signal.aborted) {
              boxes = result.boxes;
              totalH = result.totalH;
              totalW = result.totalW;
              maxExtent = result.boxes.reduce((m, bx) => Math.max(m, d === 'v' ? bx.h : bx.w), 0);
              order = sorted;
              layoutReady = true;
            }
          });
        }
      });
    }, 16);
    // Rearm layout work on key changes; teardown is handled by onDestroy.
  });

  onDestroy(() => {
    if (layoutTimer !== undefined) clearTimeout(layoutTimer);
    currentAbort?.abort();
  });

  // Virtual window
  let visibleBoxes = $derived.by(() => {
    if (!layoutReady || boxes.length === 0) return [];
    const viewportSize = dir === 'v' ? viewportH : containerW;
    const scrollPos = dir === 'v' ? scrollTop : scrollLeftPos;
    const buffer = viewportSize * bufferScreens;
    const from = scrollPos - buffer;
    const to = scrollPos + viewportSize + buffer;
    const indices = windowIndices(boxes, order, dir, from, to, maxExtent);
    return indices.map((i) => ({ box: boxes[i], index: i }));
  });

  // Marquee hits: computed inside onMove (marqueeRect is only used for rendering)

  function handleScroll(e: Event) {
    const el = e.currentTarget as HTMLDivElement;
    scrollTop = el.scrollTop;
    scrollLeftPos = el.scrollLeft;
    scroll.y = scrollTop;
    scroll.x = scrollLeftPos;
  }

  // Optimistic cards use SHA-256 operations, queued behind their upload operation.
  /** Failed upload cards are excluded from preview and selection. */
  const isFailedUpload = (id: number) => overlays.get(id)?.failed === true;

  function handlePhotoClick(photo: Photo) {
    if (multiMode) {
      toggleSelect(photo.id);
      return;
    }
    if (isFailedUpload(photo.id)) return;
    // The index must be resolved against the array the Lightbox renders, which is the
    // resolved against the preview list, not the laid-out one: failed uploads are laid
    // out but are not photos to look at.
    const idx = lightboxPhotos.findIndex((p) => p.id === photo.id);
    if (idx < 0) return;
    lightboxIndex = idx;
    lightboxOpen = true;
  }

  // The preview list can shrink underneath an open Lightbox (/sync drops a
  // duplicate, a photo gets deleted): clamp instead of leaving a dead index.
  $effect(() => {
    if (lightboxPhotos.length === 0) {
      if (lightboxOpen) lightboxOpen = false;
      lightboxIndex = 0;
      return;
    }
    if (lightboxIndex > lightboxPhotos.length - 1) lightboxIndex = lightboxPhotos.length - 1;
    if (lightboxIndex < 0) lightboxIndex = 0;
  });

  function handleLongPress(photo: Photo) {
    if (isFailedUpload(photo.id)) return;
    if (!multiMode) {
      multiMode = true;
      onMultiModeChange?.(true);
    }
    selected.add(photo.id);
    selected = new Set(selected);
  }

  function toggleSelect(id: number) {
    if (isFailedUpload(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    if (selected.size === 0 && multiMode) {
      multiMode = false;
      onMultiModeChange?.(false);
    }
  }

  function selectAll() {
    selected = new Set(allPhotos.filter((p) => !isFailedUpload(p.id)).map((p) => p.id));
  }

  function deselectAll() {
    // Only clear the selection, don't exit multi-select mode (the top bar icon handles exiting)
    selected = new Set();
  }

  /** Marquee selection uses canvas coordinates and edge auto-scroll. Touch gestures along the scroll axis retain native scrolling. */
  function handleMarqueeDown(e: PointerEvent) {
    if (!multiMode) return;

    const scrollEl = containerEl;
    if (!scrollEl) return;

    // Read live scroll offsets when mapping pointer coordinates onto the canvas.
    const toCanvas = (cx: number, cy: number) =>
      dir === 'v'
        ? {
            x: cx - scrollEl.getBoundingClientRect().left - padX,
            y: cy - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop - padTop,
          }
        : {
            x: cx - scrollEl.getBoundingClientRect().left + scrollEl.scrollLeft - padX,
            y: cy - scrollEl.getBoundingClientRect().top - padTop,
          };
    const start = toCanvas(e.clientX, e.clientY);
    const origin = { x: e.clientX, y: e.clientY };
    const pointer = { x: e.clientX, y: e.clientY };
    const scrollAxis: 'x' | 'y' = dir === 'v' ? 'y' : 'x';
    /** Pointer travel before the axis is read (below it the gesture is still ambiguous). */
    const GATE_PX = 8;
    /** Distance from the container edge at which the drag starts scrolling it. */
    const EDGE_PX = 48;
    let armed = e.pointerType === 'mouse';
    let raf = 0;
    marqueeBase = new Set(selected);
    marqueeMoved = false;

    /** Recompute the rectangle from the pointer's SCREEN position (canvas coords move as we scroll). */
    const paint = () => {
      const cur = toCanvas(pointer.x, pointer.y);
      marqueeRect = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      // Dragging past the threshold counts as a marquee gesture: suppress the click synthesized onto the card (click-select)
      if (marqueeRect.w > 4 || marqueeRect.h > 4) marqueeMoved = true;
      // Marquee hits join the selection in real time: base on the snapshot, avoiding writes to an effect's own dependency (a cycle)
      const next = new Set(marqueeBase);
      for (const id of marqueeHits(boxes, marqueeRect)) {
        if (!isFailedUpload(id)) next.add(id);
      }
      selected = next;
    };

    /** Keep scrolling while the pointer rests in an edge zone, re-selecting each frame. */
    const step = () => {
      const r = scrollEl.getBoundingClientRect();
      const speed = (penetration: number) => Math.round(Math.min(22, 4 + penetration / 3));
      let dx = 0;
      let dy = 0;
      if (dir === 'v') {
        if (pointer.y < r.top + EDGE_PX) dy = -speed(r.top + EDGE_PX - pointer.y);
        else if (pointer.y > r.bottom - EDGE_PX) dy = speed(pointer.y - (r.bottom - EDGE_PX));
      } else {
        if (pointer.x < r.left + EDGE_PX) dx = -speed(r.left + EDGE_PX - pointer.x);
        else if (pointer.x > r.right - EDGE_PX) dx = speed(pointer.x - (r.right - EDGE_PX));
      }
      if (dx !== 0 || dy !== 0) {
        scrollEl.scrollBy({ left: dx, top: dy });
        paint();
      }
      raf = requestAnimationFrame(step);
    };

    const finish = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      marqueeActive = false;
      marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    const onMove = (ev: PointerEvent) => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      if (!armed) {
        const dx = Math.abs(ev.clientX - origin.x);
        const dy = Math.abs(ev.clientY - origin.y);
        if (Math.max(dx, dy) < GATE_PX) return;
        // Dominant axis decides: along the scroll axis → this is a scroll, not a selection.
        if (scrollAxis === 'y' ? dy >= dx : dx >= dy) {
          finish();
          return;
        }
        armed = true;
        marqueeActive = true;
        marqueeRect = { ...start, w: 0, h: 0 };
      }
      paint();
    };

    if (armed) {
      marqueeActive = true;
      marqueeRect = { ...start, w: 0, h: 0 };
      raf = requestAnimationFrame(step);
    } else {
      marqueeActive = false;
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  /** Suppress the card click right after a marquee gesture (stopped in the capture phase to avoid accidental selection). */
  function suppressCardClick(e: MouseEvent) {
    if (marqueeMoved) {
      e.stopPropagation();
      e.preventDefault();
      marqueeMoved = false;
    }
  }

  // Ctrl+A
  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && multiMode) {
        e.preventDefault();
        selectAll();
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  function handleLightboxNavigate(index: number) {
    lightboxIndex = index;
  }

  onMount(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerW = entry.contentRect.width;
        viewportH = entry.contentRect.height;
      }
    });
    ro.observe(containerEl);
    const rect = containerEl.getBoundingClientRect();
    containerW = rect.width;
    viewportH = rect.height;
    return () => ro.disconnect();
  });
</script>

<div class="relative h-full w-full">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={containerEl}
    class="relative h-full w-full overflow-auto {dir === 'v' ? 'touch-pan-y' : 'touch-pan-x'}"
    onscroll={handleScroll}
    onclickcapture={suppressCardClick}
    ondragstart={(e) => e.preventDefault()}
    onpointerdown={(e) => {
      handleMarqueeDown(e);
      onPinchDown(e);
    }}
    onpointermove={onPinchMove}
    onpointerup={onPinchUp}
    onpointercancel={onPinchUp}
    use:wheelZoom
    style="cursor: {multiMode ? 'crosshair' : 'auto'}"
  >
    <div
      class="relative"
      style="margin: {dir === 'h'
        ? `${padTop}px ${padX}px 0 ${padX}px`
        : `${padTop}px ${padX}px 0`}; width: {dir === 'h'
        ? `${totalW}px`
        : `calc(100% - ${padX * 2}px)`}; height: {dir === 'v'
        ? `${totalH}px`
        : `calc(100% - ${padTop + padX}px)`}"
    >
      {#each visibleBoxes as { box } (box.id)}
        {@const photo = photoMap.get(box.id)}
        {#if photo}
          <PhotoCard
            {photo}
            {selfId}
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            overlay={overlays.get(photo.id)}
            onRetryUpload={() => onRetryUpload?.(photo)}
            onDismissUpload={() => onDismissUpload?.(photo)}
            selected={selected.has(photo.id)}
            {multiMode}
            onClick={() => handlePhotoClick(photo)}
            onLongPress={() => handleLongPress(photo)}
            onLike={() => onLike?.(photo)}
            onDislike={() => onDislike?.(photo)}
            onRequestDelete={() => onRequestDelete?.(photo)}
          />
        {/if}
      {/each}
    </div>
  </div>

  <!-- Marquee overlay -->
  {#if marqueeActive && (marqueeRect.w > 2 || marqueeRect.h > 2)}
    <div
      class="pointer-events-none absolute z-30 border-2 border-primary/60 bg-primary/10"
      style="left: {dir === 'v'
        ? marqueeRect.x + padX
        : marqueeRect.x - scrollLeftPos + padX}px; top: {dir === 'v'
        ? marqueeRect.y - scrollTop + padTop
        : marqueeRect.y + padTop}px; width: {marqueeRect.w}px; height: {marqueeRect.h}px"
    ></div>
  {/if}

  <MultiSelectBar
    {selected}
    photos={allPhotos}
    {selfId}
    visible={multiMode}
    onSelectAll={selectAll}
    onDeselectAll={deselectAll}
    onDownload={() => onDownloadSelected?.([...selected])}
    onUnmark={() => onUnmarkSelected?.([...selected])}
    onDelete={() => {
      const ids = [...selected];
      onDeleteSelected?.(ids);
      selected = new Set();
      if (multiMode) {
        multiMode = false;
        onMultiModeChange?.(false);
      }
    }}
  />
</div>

<Lightbox
  bind:open={lightboxOpen}
  photos={lightboxPhotos}
  currentIndex={lightboxPhotos.length > 0
    ? Math.min(Math.max(lightboxIndex, 0), lightboxPhotos.length - 1)
    : 0}
  {selfId}
  onClose={() => (lightboxOpen = false)}
  onNavigate={handleLightboxNavigate}
  {onLike}
  {onDislike}
  {onRequestDelete}
  {onDelete}
  {onDownload}
/>
