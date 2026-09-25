<script lang="ts">
  // Full-screen media lightbox as a plain div layer: a shadcn Dialog's focus traps and inert would interfere with gesture bubbling.
  // v1 gestures via direct DOM transforms: swipe left/right = like/dislike (auto-advance), down = download, up = action sheet;
  // hints fade/scale with the drag and spring back below the threshold; double-click/pinch/Ctrl+wheel zoom, drag pans; no click paging.
  import type { Photo } from '$shared/types';
  import {
    X,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Copy,
    Link2,
    Share2,
    Search,
    ThumbsUp,
    ThumbsDown,
    Flag,
    Trash2,
    Download,
    VolumeX,
    Volume2,
  } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { proxyUrl } from '../../core/id36';
  import { humanSize } from '$base/lib/format';
  import ActionSheet from './ActionSheet.svelte';
  import Tooltip from './Tooltip.svelte';

  interface Props {
    photos: Photo[];
    currentIndex: number;
    selfId?: number;
    open: boolean;
    onClose?: () => void;
    onNavigate?: (index: number) => void;
    onLike?: (photo: Photo) => void;
    onDislike?: (photo: Photo) => void;
    onRequestDelete?: (photo: Photo) => void;
    onDelete?: (photo: Photo) => void;
    onDownload?: (photo: Photo) => void;
  }

  let {
    photos,
    currentIndex,
    selfId = -1,
    open = $bindable(false),
    onClose,
    onNavigate,
    onLike,
    onDislike,
    onRequestDelete,
    onDelete,
    onDownload,
  }: Props = $props();

  /** Directional swipe threshold (px). */
  const SWIPE_THRESHOLD = 60;
  /** Zoom bounds. */
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  let showMenu = $state(false);
  let volumeMuted = $state(true);

  let photo = $derived(photos[currentIndex]);
  let isLiked = $derived(photo?.likes.includes(selfId) ?? false);
  let isDisliked = $derived(photo?.dislikes.includes(selfId) ?? false);
  let isReported = $derived(photo?.reports.includes(selfId) ?? false);
  /** Timestamp label (year-month-day hour:minute), bottom-left. */
  let createdLabel = $derived(
    photo
      ? new Date(photo.createdAt).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '',
  );
  let origin = $derived(typeof window === 'undefined' ? '' : window.location.origin);

  // ---- gesture state (non-reactive: high-frequency pointer moves write the
  //      DOM directly to stay in sync) ----------------------------------------
  let stageEl = $state<HTMLElement | undefined>(undefined);
  let wrapEl = $state<HTMLElement | undefined>(undefined);

  let scale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let dragging = false;
  let panning = false;
  let gestureMoved = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  const active = new Map<number, { x: number; y: number }>();
  let downPoint = { x: 0, y: 0 };

  /** Direction hint (reactive: only these two values go through render). */
  let gestureDir = $state<null | 'left' | 'right' | 'up' | 'down'>(null);
  let gestureRatio = $state(0);

  function applyWrap(dx = 0, dy = 0, animate = false): void {
    if (!wrapEl) return;
    wrapEl.style.transition = animate ? 'transform var(--duration-exit) var(--ease-exit)' : 'none';
    wrapEl.style.transform = `translate(${zoomX + dx}px, ${zoomY + dy}px) scale(${scale})`;
  }

  function resetZoom(animate = false): void {
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    applyWrap(0, 0, animate);
  }

  /** Pan clamping while zoomed: media edges do not pass the viewport centre. */
  function clampPan(): void {
    if (!stageEl) return;
    const maxX = ((scale - 1) * stageEl.clientWidth) / 2;
    const maxY = ((scale - 1) * stageEl.clientHeight) / 2;
    zoomX = Math.min(maxX, Math.max(-maxX, zoomX));
    zoomY = Math.min(maxY, Math.max(-maxY, zoomY));
  }

  function distance(): number {
    const [a, b] = [...active.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    if (showMenu) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 1) {
      dragging = true;
      gestureMoved = false;
      downPoint = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } else if (active.size === 2) {
      // Second pointer: switch to pinch and clear the drag preview.
      pinchStartDist = distance();
      pinchStartScale = scale;
      dragging = false;
      gestureDir = null;
      gestureRatio = 0;
      applyWrap();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!active.has(e.pointerId)) return;
    const start = active.get(e.pointerId)!;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (active.size >= 2) {
      // Pinch zoom
      const d = distance();
      if (pinchStartDist > 0) {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (d / pinchStartDist) * pinchStartScale));
        if (scale <= MIN_SCALE + 0.01) {
          zoomX = 0;
          zoomY = 0;
        }
        gestureMoved = true;
        applyWrap();
      }
      return;
    }

    if (!dragging) return;
    if (Math.abs(e.clientX - downPoint.x) > 4 || Math.abs(e.clientY - downPoint.y) > 4)
      gestureMoved = true;

    if (panning || scale > 1.01) {
      // Zoomed: dragging pans, accumulating with each move.
      panning = true;
      zoomX += dx;
      zoomY += dy;
      clampPan();
      applyWrap();
      return;
    }

    // Unzoomed: the preview is relative to the press point (a per-move delta
    // would only be a few pixels and the image would barely move).
    const previewDx = e.clientX - downPoint.x;
    const previewDy = e.clientY - downPoint.y;
    applyWrap(previewDx, previewDy);
    const ax = Math.abs(previewDx);
    const ay = Math.abs(previewDy);
    const dir = ax > ay ? (previewDx > 0 ? 'right' : 'left') : previewDy > 0 ? 'down' : 'up';
    const dist = Math.max(ax, ay);
    if (dist > 10) {
      gestureDir = dir;
      gestureRatio = Math.min(dist / SWIPE_THRESHOLD, 1);
    } else {
      gestureDir = null;
      gestureRatio = 0;
    }
  }

  /** Shared entry for mark actions (top-bar icons, keyboard, gestures). */
  function toggleLike(): void {
    if (!photo) return;
    onLike?.(photo);
    toast.success(photo.likes.includes(selfId) ? '已标记喜欢' : '已取消喜欢');
  }

  function toggleDislike(): void {
    if (!photo) return;
    onDislike?.(photo);
    toast.success(photo.dislikes.includes(selfId) ? '已标记不喜欢' : '已取消不喜欢');
  }

  function toggleReport(): void {
    if (!photo) return;
    onRequestDelete?.(photo);
    // Direction note: reports containing self means "delete requested".
    toast.success(photo.reports.includes(selfId) ? '已请求删除' : '已取消请求删除');
  }

  function triggerGesture(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (!photo) return;
    applyWrap(0, 0, true);
    if (dir === 'left' || dir === 'right') {
      if (dir === 'left') toggleLike();
      else toggleDislike();
      gestureDir = dir;
      gestureRatio = 1;
      setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
        if (currentIndex < photos.length - 1) onNavigate?.(currentIndex + 1);
      }, 200);
    } else if (dir === 'down') {
      onDownload?.(photo);
      toast.success('开始下载');
      gestureDir = dir;
      gestureRatio = 1;
      setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
      }, 250);
    } else {
      showMenu = true;
    }
  }

  function onPointerUp(e: PointerEvent) {
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (active.size < 2) pinchStartDist = 0;
    if (active.size > 0) return; // One of multiple pointers released; wait.

    dragging = false;
    const wasPanning = panning;
    panning = false;

    if (!start) return;
    // Direction uses the total displacement from the press point (same as the
    // drag preview).
    const dx = e.clientX - downPoint.x;
    const dy = e.clientY - downPoint.y;

    // Zoomed drag ends: position is clamped, settle in place.
    if (wasPanning) {
      applyWrap(0, 0, true);
      return;
    }

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const dist = Math.max(ax, ay);
    if (dist >= SWIPE_THRESHOLD) {
      const dir = ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      triggerGesture(dir as 'left' | 'right' | 'up' | 'down');
      return;
    }

    // Below the threshold: spring back.
    gestureDir = null;
    gestureRatio = 0;
    applyWrap(0, 0, true);
  }

  function onDblClick(): void {
    if (showMenu || gestureMoved) return;
    if (scale > 1.01) resetZoom(true);
    else {
      scale = 2;
      applyWrap(0, 0, true);
    }
  }

  /** Desktop Ctrl+wheel zoom; passive:false is required to stop browser zoom,
   *  bound through an action. */
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - e.deltaY * 0.002));
      if (scale <= MIN_SCALE + 0.01) {
        zoomX = 0;
        zoomY = 0;
      } else {
        clampPan();
      }
      applyWrap();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      },
    };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    // While the menu is open, arrows / Escape only close it and never reach
    // the gestures (no marking or paging behind the menu). Other keys are
    // swallowed so the photo cannot move behind a suspended menu.
    if (showMenu) {
      if (e.key === 'Escape' || e.key.startsWith('Arrow')) {
        e.preventDefault();
        showMenu = false;
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        onClose?.();
        break;
      // Desktop arrows equal swipe gestures: mark and auto-advance.
      case 'ArrowLeft':
        triggerGesture('left');
        break;
      case 'ArrowRight':
        triggerGesture('right');
        break;
      case 'PageUp':
        goPrev();
        break;
      case 'PageDown':
        goNext();
        break;
      case 'ArrowUp':
        showMenu = true;
        break;
      case 'ArrowDown':
        if (photo) onDownload?.(photo);
        break;
      case ' ':
        e.preventDefault();
        if (photo?.type === 2) volumeMuted = !volumeMuted;
        break;
      case 'Control':
        // Double-tap Ctrl resets zoom.
        if (scale > 1.01) resetZoom(true);
        break;
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      onNavigate?.(currentIndex - 1);
    }
  }
  function goNext() {
    if (currentIndex < photos.length - 1) {
      onNavigate?.(currentIndex + 1);
    }
  }

  // On switch: reset transforms and mute (wrap may be unmounted; the effect
  // after mount covers it).
  $effect(() => {
    void currentIndex;
    volumeMuted = true;
    gestureDir = null;
    gestureRatio = 0;
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    if (wrapEl) applyWrap();
  });

  // Lock page scrolling while open.
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  });

  // ---- menu actions ----------------------------------------------------------

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('复制失败');
    }
  }

  /** Proxy URL for out-of-site sharing (host URLs never leave the Worker). */
  let shareUrl = $derived(photo ? proxyUrl(origin, photo.id) : '');

  /**
   * Open transition: the element mounts inside `{#if open}`; if it already
   * had `.show` the transition would not play. Mount without it and add the
   * class on the next frame.
   */
  let shown = $state(false);
  $effect(() => {
    if (!open) {
      shown = false;
      return;
    }
    const raf = requestAnimationFrame(() => (shown = true));
    return () => cancelAnimationFrame(raf);
  });

  async function share() {
    if (!photo) return;
    if (navigator.share) {
      try {
        await navigator.share({ url: shareUrl });
      } catch {
        // User cancellation: no toast.
      }
    } else {
      await copyText(shareUrl, '链接已复制');
    }
    showMenu = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && photo}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={stageEl}
    class="fixed inset-0 z-70 touch-none bg-black/92 opacity-0 backdrop-blur-[8px] pointer-events-none invisible transition-[opacity,visibility] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:show={shown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDblClick}
    use:wheelZoom
  >
    <!-- Top bar info: bare text top-left, more/close top-right -->
    <div
      class="absolute inset-x-3 top-3 z-10 flex items-start justify-between md:inset-x-4 md:top-4"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="lb-meta flex items-center gap-3 text-base">
        <span class="tabular-nums text-white/90">{currentIndex + 1} / {photos.length}</span>
        <Tooltip text={isLiked ? '取消喜欢' : '喜欢'} side="bottom">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isLiked
              ? 'bg-[#f43f5e]/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleLike}
          >
            <ThumbsUp class="size-5 {isLiked ? 'fill-current' : 'text-[#f43f5e]'}" />
            <span class="tabular-nums">{photo.likes.length}</span>
          </button>
        </Tooltip>
        <Tooltip text={isDisliked ? '取消不喜欢' : '不喜欢'} side="bottom">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isDisliked
              ? 'bg-[#3b82f6]/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleDislike}
          >
            <ThumbsDown class="size-5 {isDisliked ? 'fill-current' : 'text-[#3b82f6]'}" />
            <span class="tabular-nums">{photo.dislikes.length}</span>
          </button>
        </Tooltip>
        <Tooltip text={isReported ? '取消请求删除' : '请求删除'} side="bottom">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isReported
              ? 'bg-amber-500/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleReport}
          >
            <Flag class="size-5 {isReported ? 'fill-current' : 'text-amber-400'}" />
            <span class="tabular-nums">{photo.reports.length}</span>
          </button>
        </Tooltip>
      </div>

      <div class="flex items-center gap-0.5">
        <Tooltip text="更多" side="bottom">
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10"
            onclick={() => (showMenu = true)}
          >
            <MoreHorizontal class="size-6" />
          </button>
        </Tooltip>
        <Tooltip text="关闭" side="bottom">
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10"
            onclick={onClose}
          >
            <X class="size-6" />
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Media: the gesture layer writes the wrap transform directly to the DOM for pointer-following.
         Sizing keeps a margin on every edge: only max-h-screen/max-w-full on narrow screens fills the
         width (or overflows at native pixel size) and covers the info bars. -->
    <div class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        bind:this={wrapEl}
        class="flex max-w-full select-none items-center justify-center will-change-transform"
      >
        {#if photo.type !== 0}
          <!-- type=1 (silent WebM) and type=2 (video with audio) both use video -->
          <video
            src={photo.url}
            class="lb-media"
            draggable="false"
            muted={volumeMuted}
            loop
            autoplay
            playsinline
          ></video>
        {:else}
          <img src={photo.url} alt="" class="lb-media" draggable="false" />
        {/if}
      </div>
    </div>

    <!-- Direction gesture hints: fade and scale with the drag ratio -->
    {#if gestureDir}
      {#if gestureDir === 'left'}
        <div
          class="pointer-events-none absolute left-10 top-1/2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-[#f43f5e] backdrop-blur-sm md:left-16"
          style="opacity: {gestureRatio}; transform: translateY(-50%) scale({0.8 +
            gestureRatio * 0.4})"
        >
          <ThumbsUp class="size-6" />
        </div>
      {:else if gestureDir === 'right'}
        <div
          class="pointer-events-none absolute right-10 top-1/2 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-[#3b82f6] backdrop-blur-sm md:right-16"
          style="opacity: {gestureRatio}; transform: translateY(-50%) scale({0.8 +
            gestureRatio * 0.4})"
        >
          <ThumbsDown class="size-6" />
        </div>
      {:else if gestureDir === 'up'}
        <div
          class="pointer-events-none absolute left-1/2 top-20 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
          style="opacity: {gestureRatio}; transform: translateX(-50%) scale({0.8 +
            gestureRatio * 0.4})"
        >
          <MoreHorizontal class="size-6" />
        </div>
      {:else}
        <div
          class="pointer-events-none absolute bottom-28 left-1/2 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-success backdrop-blur-sm"
          style="opacity: {gestureRatio}; transform: translateX(-50%) scale({0.8 +
            gestureRatio * 0.4})"
        >
          <Download class="size-6" />
        </div>
      {/if}
    {/if}

    <!-- Video volume button (type=2, 2.4rem in the lightbox) -->
    {#if photo.type === 2}
      <Tooltip text={volumeMuted ? '取消静音' : '静音'} side="left">
        <button
          type="button"
          class="absolute bottom-24 right-5 z-10 flex items-center justify-center rounded-full text-white/75 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 md:right-6"
          style="width: 2.4rem; height: 2.4rem"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => (volumeMuted = !volumeMuted)}
        >
          {#if volumeMuted}
            <VolumeX class="size-5 text-amber-500" />
          {:else}
            <Volume2 class="size-5" />
          {/if}
        </button>
      </Tooltip>
    {/if}

    <!-- Bottom bar info: dimensions/size bottom-left, prev/next bottom-right -->
    <div
      class="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between md:inset-x-4 md:bottom-4"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="lb-meta space-y-0.5 text-xs text-white/65">
        <div class="tabular-nums">
          {photo.width}×{photo.height}
          {humanSize(photo.size)}
        </div>
        <div class="tabular-nums text-white/55">{createdLabel}</div>
      </div>

      <div class="flex items-center gap-1">
        <Tooltip text="上一张">
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
            disabled={currentIndex === 0}
            onclick={goPrev}
          >
            <ChevronLeft class="size-6" />
          </button>
        </Tooltip>
        <Tooltip text="下一张">
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
            disabled={currentIndex === photos.length - 1}
            onclick={goNext}
          >
            <ChevronRight class="size-6" />
          </button>
        </Tooltip>
      </div>
    </div>
  </div>

  <!-- More menu (bottom action sheet) -->
  <ActionSheet bind:open={showMenu} onClose={() => (showMenu = false)}>
    <div class="grid grid-cols-3 gap-3">
      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          void copyText(photo.url, '原图地址已复制');
          showMenu = false;
        }}
      >
        <Copy class="size-6" />
        <span class="text-sm">复制原图</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          void copyText(shareUrl, '链接已复制');
          showMenu = false;
        }}
      >
        <Link2 class="size-6" />
        <span class="text-sm">复制链接</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={share}
      >
        <Share2 class="size-6" />
        <span class="text-sm">分享</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          window.open(
            `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(shareUrl)}`,
            '_blank',
          );
          showMenu = false;
        }}
      >
        <Search class="size-6" />
        <span class="text-sm">谷歌搜图</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-amber-500 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          onRequestDelete?.(photo);
          showMenu = false;
        }}
      >
        <Flag class="size-6" />
        <span class="text-sm">{isReported ? '取消删除' : '请求删除'}</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-success transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-success/10"
        onclick={() => {
          onDownload?.(photo);
          showMenu = false;
        }}
      >
        <Download class="size-6" />
        <span class="text-sm">下载</span>
      </button>

      {#if selfId === 0}
        <button
          type="button"
          class="flex flex-col items-center gap-2 rounded-xl p-4 text-destructive transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-destructive/10"
          onclick={() => {
            onDelete?.(photo);
            showMenu = false;
          }}
        >
          <Trash2 class="size-6" />
          <span class="text-sm">删除</span>
        </button>
      {/if}
    </div>
  </ActionSheet>
{/if}

<style>
  .lb-meta {
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
  }

  /*
   * Media sizing: vertical space for the top/bottom bars, horizontal margins on narrow screens
   * (also the system edge-gesture area). Only max-h-screen + max-w-full relative to an
   * unconstrained flex container degrades to native-pixel overflow on narrow screens.
   */
  .lb-media {
    max-width: calc(100vw - 2.5rem);
    max-height: calc(100dvh - 8rem);
    border-radius: 14px;
    object-fit: contain;
  }

  @media (min-width: 768px) {
    .lb-media {
      max-width: calc(100vw - 8rem);
      max-height: calc(100dvh - 9rem);
    }
  }

  .show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
</style>
