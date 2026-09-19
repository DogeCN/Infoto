<script lang="ts">
  import { onMount } from "svelte";
  import {
    computeLayoutChunked,
    orderByMain,
    windowIndices,
    type LayoutBox,
    type ScrollDir,
    type FillStrategy,
  } from "$base/lib/layout";
  import { marqueeHits, type Rect } from "$base/lib/marquee";
  import type { Photo } from "$shared/types";
  import PhotoCard from "./PhotoCard.svelte";
  import Lightbox from "./Lightbox.svelte";
  import MultiSelectBar from "./MultiSelectBar.svelte";

  interface Props {
    photos: Photo[];
    dir?: ScrollDir;
    strategy?: FillStrategy;
    band?: number;
    gap?: number;
    bufferScreens?: number;
    selfId?: number;
    multiMode?: boolean;
    onMultiModeChange?: (v: boolean) => void;
    // 写操作全部由上层落成 op（契约：所有写操作走 op-log → /sync 管线）
    onLike?: (photo: Photo) => void;
    onDislike?: (photo: Photo) => void;
    onRequestDelete?: (photo: Photo) => void;
    /** 撤销已作的喜欢/不喜欢标记。 */
    onUnmark?: (photo: Photo) => void;
    /** 仅根用户：delete op。 */
    onDelete?: (photo: Photo) => void;
    onDeleteSelected?: (ids: number[]) => void;
    onDownloadSelected?: (ids: number[]) => void;
    /** 批量取消标记（喜欢/不喜欢/请求删除全部撤销）。 */
    onUnmarkSelected?: (ids: number[]) => void;
    /** 单张下载（Lightbox 下滑手势）。 */
    onDownload?: (photo: Photo) => void;
  }

  let {
    photos,
    dir = "v",
    strategy = "sequential",
    band = 320,
    gap = 8,
    bufferScreens = 2,
    selfId = -1,
    multiMode = $bindable(false),
    onMultiModeChange,
    onLike,
    onDislike,
    onRequestDelete,
    onUnmark,
    onDelete,
    onDeleteSelected,
    onDownloadSelected,
    onUnmarkSelected,
    onDownload,
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let scrollTop = $state(0);
  let viewportH = $state(0);
  let containerW = $state(0);

  // 缩放（契约：桌面 Ctrl+滚轮 / 移动端捏合，50%–200%），作用于目标带宽
  let zoom = $state(1);
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;

  function applyZoom(factor: number): void {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  }

  /** Ctrl+滚轮缩放：需 passive:false 才能阻止浏览器页面缩放，故用 action 绑定。 */
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoom * Math.exp(-e.deltaY * 0.0025));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener("wheel", onWheel);
      },
    };
  }

  // 移动端双指捏合
  const pinch = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let pinchZoom = 1;

  function onPinchDown(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
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
  let order = $state<number[]>([]);
  let layoutReady = $state(false);
  let currentAbort: AbortController | null = null;

  // Selection state
  let selected = $state<Set<number>>(new Set());

  // Marquee state
  let marqueeActive = $state(false);
  let marqueeStart = $state({ x: 0, y: 0 });
  let marqueeRect = $state<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // Lightbox state
  let lightboxOpen = $state(false);
  let lightboxIndex = $state(0);

  // Layout items derived from photos
  let layoutItems = $derived(
    photos.map((p) => ({ id: p.id, w: p.width || 1, h: p.height || 1 })),
  );
  let photoMap = $derived(new Map(photos.map((p) => [p.id, p])));

  // Recompute layout when dependencies change
  $effect(() => {
    const items = layoutItems;
    const w = containerW;
    const d = dir;
    const s = strategy;
    // 缩放作用于目标带宽（50%–200%）
    const b = Math.round(band * zoom);
    const g = gap;
    if (w <= 0 || items.length === 0) {
      boxes = [];
      totalH = 0;
      order = [];
      layoutReady = false;
      return;
    }
    currentAbort?.abort();
    const controller = new AbortController();
    currentAbort = controller;
    const opts = { dir: d, strategy: s, cross: w, band: b, gap: g };
    computeLayoutChunked(items, opts, 400, controller.signal).then((result) => {
      if (result && !controller.signal.aborted) {
        boxes = result.boxes;
        totalH = result.totalH;
        order = orderByMain(result.boxes, d);
        layoutReady = true;
      }
    });
  });

  // Virtual window
  let visibleBoxes = $derived.by(() => {
    if (!layoutReady || boxes.length === 0) return [];
    const viewportSize = dir === "v" ? viewportH : containerW;
    const scrollPos = dir === "v" ? scrollTop : 0;
    const buffer = viewportSize * bufferScreens;
    const maxExtent = band + gap;
    const from = scrollPos - buffer;
    const to = scrollPos + viewportSize + buffer;
    const indices = windowIndices(boxes, order, dir, from, to, maxExtent);
    return indices.map((i) => ({ box: boxes[i], index: i }));
  });

  // Marquee hits in real time
  let marqueeHitIds = $derived.by((): Set<number> => {
    if (!marqueeActive || (marqueeRect.w === 0 && marqueeRect.h === 0))
      return new Set();
    return new Set(marqueeHits(boxes, marqueeRect));
  });

  function handleScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  function handlePhotoClick(photo: Photo) {
    if (multiMode) {
      toggleSelect(photo.id);
    } else {
      lightboxIndex = photos.findIndex((p) => p.id === photo.id);
      lightboxOpen = true;
    }
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
    selected = new Set(photos.map((p) => p.id));
  }

  function deselectAll() {
    selected = new Set();
    if (multiMode) {
      multiMode = false;
      onMultiModeChange?.(false);
    }
  }

  // Marquee: pointerdown on the scroll container
  function handleMarqueeDown(e: PointerEvent) {
    if (!multiMode) return;
    // Only start marquee on the container background, not on cards
    if ((e.target as HTMLElement).closest('[role="button"]')) return;

    const scrollEl = containerEl;
    if (!scrollEl) return;

    marqueeActive = true;
    marqueeStart = { x: e.clientX, y: e.clientY + scrollTop };
    marqueeRect = { x: e.clientX, y: e.clientY + scrollTop, w: 0, h: 0 };

    const onMove = (ev: PointerEvent) => {
      const curX = ev.clientX;
      const curY = ev.clientY + scrollTop;
      marqueeRect = {
        x: Math.min(marqueeStart.x, curX),
        y: Math.min(marqueeStart.y, curY),
        w: Math.abs(curX - marqueeStart.x),
        h: Math.abs(curY - marqueeStart.y),
      };
    };

    const onUp = () => {
      marqueeActive = false;
      marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Apply marquee hits to selection while dragging
  $effect(() => {
    if (marqueeActive && marqueeHitIds.size > 0) {
      const next = new Set(selected);
      for (const id of marqueeHitIds) next.add(id);
      selected = next;
    }
  });

  // Ctrl+A
  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && multiMode) {
        e.preventDefault();
        selectAll();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
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
    class="relative h-full w-full overflow-auto touch-none"
    onscroll={handleScroll}
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
      style="width: {dir === 'h' ? `${totalH}px` : '100%'}; height: {dir === 'v'
        ? `${totalH}px`
        : '100%'}"
    >
      {#each visibleBoxes as { box, index } (box.id)}
        {@const photo = photoMap.get(box.id)}
        {#if photo}
          <PhotoCard
            {photo}
            {selfId}
            width={box.w}
            height={box.h}
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
      style="left: {marqueeRect.x}px; top: {marqueeRect.y -
        scrollTop}px; width: {marqueeRect.w}px; height: {marqueeRect.h}px"
    ></div>
  {/if}

  <MultiSelectBar
    {selected}
    {photos}
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
  {onUnmark}
  {onDownload}
/>
