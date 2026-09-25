<script lang="ts">
  import { onMount } from 'svelte';
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

  interface Props {
    photos: Photo[];
    /** Pending upload entries (contract: right after info cards, before other media; excluded from sorting/filtering). */
    pending?: Photo[];
    /** Curtain overlays for pending entries: fraction (uploading) / failed (full cover + retry). */
    overlays?: Map<number, { fraction?: number; failed?: boolean }>;
    onRetryUpload?: (photo: Photo) => void;
    dir?: ScrollDir;
    strategy?: FillStrategy;
    band?: number;
    gap?: number;
    bufferScreens?: number;
    selfId?: number;
    multiMode?: boolean;
    onMultiModeChange?: (v: boolean) => void;
    // All write operations are committed upstream as ops (contract: every write goes through op-log → /sync)
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
    overlays = new Map<number, { fraction?: number; failed?: boolean }>(),
    onRetryUpload,
    dir = 'v',
    strategy = 'sequential',
    band = 320,
    gap = 8,
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
  let padX = $state(16);
  /** Top spacing (accommodates the floating top bar; content can scroll under it for immersion). */
  let padTop = $state(80);

  // Zoom (contract: desktop Ctrl+wheel / mobile pinch, 50%–200%), applied to the target band width
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
  /** Whether the marquee rectangle was actually dragged (used to suppress card clicks). */
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

  // Recompute layout when dependencies change — debounce so rapid resize / slider drag collapses
  // into one computation per 16 ms frame instead of abort-restart per event (a freeze root cause).
  // State writes deferred to a rAF so the sort (orderByMain) and DOM batch happen in a separate frame from the generator.
  $effect(() => {
    const items = layoutItems;
    const w = containerW;
    const d = dir;
    const s = strategy;
    // Zoom applies to the target band width (50%–200%)
    const b = Math.round(band * zoom);
    const g = gap;
    if (w <= 0 || items.length === 0) {
      boxes = [];
      totalH = 0;
      order = [];
      layoutReady = false;
      return;
    }
    // Cancel previous debounce timer
    if (layoutTimer !== undefined) clearTimeout(layoutTimer);
    // Abort previous computation
    currentAbort?.abort();
    layoutTimer = setTimeout(() => {
      layoutTimer = undefined;
      const controller = new AbortController();
      currentAbort = controller;
      const opts = {
        dir: d,
        strategy: s,
        // Static cross-axis whitespace in horizontal mode: top padTop (for the floating top bar) + bottom padX
        cross: (d === 'v' ? w : viewportH) - (d === 'v' ? padX * 2 : padTop + padX),
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
              order = sorted;
              layoutReady = true;
            }
          });
        }
      });
    }, 16);
    return () => {
      if (layoutTimer !== undefined) {
        clearTimeout(layoutTimer);
        layoutTimer = undefined;
      }
    };
  });

  // Virtual window
  let visibleBoxes = $derived.by(() => {
    if (!layoutReady || boxes.length === 0) return [];
    const viewportSize = dir === 'v' ? viewportH : containerW;
    const scrollPos = dir === 'v' ? scrollTop : scrollLeftPos;
    const buffer = viewportSize * bufferScreens;
    const maxExtent = band + gap;
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

  function handlePhotoClick(photo: Photo) {
    if (multiMode) {
      toggleSelect(photo.id);
      return;
    }
    // Pending upload entries don't open the preview (they become visible after /sync settles)
    if (overlays.has(photo.id)) return;
    lightboxIndex = allPhotos.findIndex((p) => p.id === photo.id);
    lightboxOpen = true;
  }

  function handleLongPress(photo: Photo) {
    if (!multiMode) {
      multiMode = true;
      onMultiModeChange?.(true);
    }
    selected.add(photo.id);
    selected = new Set(selected);
  }

  function toggleSelect(id: number) {
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
    selected = new Set(allPhotos.map((p) => p.id));
  }

  function deselectAll() {
    // Only clear the selection, don't exit multi-select mode (the top bar icon handles exiting)
    selected = new Set();
  }

  // Marquee: pointerdown on the scroll container (starting on a card marquee-selects too)
  function handleMarqueeDown(e: PointerEvent) {
    if (!multiMode) return;

    const scrollEl = containerEl;
    if (!scrollEl) return;

    // The marquee rectangle always uses canvas coordinates (the boxes' space), decoupled from viewport/container offsets
    const rect = scrollEl.getBoundingClientRect();
    const toCanvas = (cx: number, cy: number) =>
      dir === 'v'
        ? { x: cx - rect.left - padX, y: cy - rect.top + scrollTop - padTop }
        : {
            x: cx - rect.left + scrollLeftPos - padX,
            y: cy - rect.top - padTop,
          };
    const start = toCanvas(e.clientX, e.clientY);
    marqueeBase = new Set(selected);
    marqueeMoved = false;

    marqueeActive = true;
    marqueeRect = { ...start, w: 0, h: 0 };

    const onMove = (ev: PointerEvent) => {
      const cur = toCanvas(ev.clientX, ev.clientY);
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
      for (const id of marqueeHits(boxes, marqueeRect)) next.add(id);
      selected = next;
    };

    const onUp = () => {
      marqueeActive = false;
      marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
        padX = containerW >= 768 ? 16 : 12;
        padTop = containerW >= 768 ? 80 : 64;
      }
    });
    ro.observe(containerEl);
    const rect = containerEl.getBoundingClientRect();
    containerW = rect.width;
    viewportH = rect.height;
    padX = containerW >= 768 ? 16 : 12;
    padTop = containerW >= 768 ? 80 : 64;
    return () => ro.disconnect();
  });
</script>

<div class="relative h-full w-full">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={containerEl}
    class="relative h-full w-full overflow-auto touch-none"
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
  {photos}
  currentIndex={lightboxIndex}
  {selfId}
  onClose={() => (lightboxOpen = false)}
  onNavigate={handleLightboxNavigate}
  {onLike}
  {onDislike}
  {onRequestDelete}
  {onDelete}
  {onDownload}
/>
