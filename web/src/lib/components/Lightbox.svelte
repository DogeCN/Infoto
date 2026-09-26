<script lang="ts">
  // Full-screen media lightbox as a plain div layer: a shadcn Dialog's focus traps and inert would interfere with gesture bubbling.
  // Gestures via direct DOM transforms: swipe left/right = like/dislike (auto-advance), down = download, up = action sheet;
  // hints fade/scale with the drag and spring back below the threshold; double-click/pinch/Ctrl+wheel zoom, drag pans; no click paging.
  import { MEDIA_TYPE, type Photo } from '$shared/types';
  import { copy, fmt } from '$shared/copy';
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
  import { proxyUrl } from '$base/lib/id36';
  import { humanSize } from '$base/lib/format';
  import ActionSheet from './ActionSheet.svelte';
  import TimeLabel from './TimeLabel.svelte';
  import Tooltip from './Tooltip.svelte';
  import GlitchText from './GlitchText.svelte';

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

  /** Swipe trigger distance (px) at a 768px-wide viewport; scaled per gesture by page width. */
  const SWIPE_THRESHOLD = 60;
  /** Distance (px) where the direction hint starts showing, same reference. */
  const HINT_THRESHOLD = 10;
  /** Zoom bounds. */
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;

  let showMenu = $state(false);
  let volumeMuted = $state(true);
  // loadedUrl === photo.url means the current media finished decoding (drives skeleton + opacity).
  let loadedUrl = $state('');
  // Media load failure: show a glitching status code + toast.
  let loadFailed = $state(false);
  let failStatus = $state('404');
  let failController: AbortController | null = null;

  // Per-URL status cache so switching back to a known-failing photo is instant
  // (no second HEAD round-trip). '0' = network/CORS failure, undefined = unknown.
  const statusCache = new Map<string, string>();

  let photo = $derived(photos[currentIndex]);
  let isLiked = $derived(photo?.likes.includes(selfId) ?? false);
  let isDisliked = $derived(photo?.dislikes.includes(selfId) ?? false);
  let isReported = $derived(photo?.reports.includes(selfId) ?? false);
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
  /** Viewport-scaled thresholds for the gesture in flight (set on pointerdown). */
  let hintAt = HINT_THRESHOLD;
  let triggerAt = SWIPE_THRESHOLD;

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

  /** Page-width-proportional thresholds: `base` is defined for a 768px-wide
   *  viewport and scales linearly with the page width — no device clamping, so
   *  wide screens need a proportionally longer drag instead of a touch. */
  function scaledThreshold(base: number): number {
    const w = typeof window === 'undefined' ? 768 : window.innerWidth;
    return Math.round((base * w) / 768);
  }

  function onPointerDown(e: PointerEvent) {
    if (showMenu) return;
    hintAt = scaledThreshold(HINT_THRESHOLD);
    triggerAt = scaledThreshold(SWIPE_THRESHOLD);
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
    if (dist > hintAt) {
      gestureDir = dir;
      gestureRatio = Math.min(dist / triggerAt, 1);
    } else {
      gestureDir = null;
      gestureRatio = 0;
    }
  }

  /** Explicit toggles (top-bar icon buttons only). */
  function toggleLike(): void {
    if (!photo) return;
    onLike?.(photo);
    toast.success(photo.likes.includes(selfId) ? copy.lightbox.liked : copy.lightbox.unliked);
  }

  function toggleDislike(): void {
    if (!photo) return;
    onDislike?.(photo);
    toast.success(
      photo.dislikes.includes(selfId) ? copy.lightbox.disliked : copy.lightbox.undisliked,
    );
  }

  function toggleReport(): void {
    if (!photo) return;
    onRequestDelete?.(photo);
    // Direction note: reports containing self means "delete requested".
    toast.success(
      photo.reports.includes(selfId) ? copy.lightbox.reported : copy.lightbox.reportCancelled,
    );
  }

  /** Gesture/arrow marks are one-way: repeating them must not cancel the mark
   *  (only the top-bar buttons toggle). Cross-marks still switch, since the
   *  store drops the opposite mark when adding a new one. */
  function markLike(): void {
    if (isLiked) {
      toast.success(copy.lightbox.liked);
      return;
    }
    toggleLike();
  }

  function markDislike(): void {
    if (isDisliked) {
      toast.success(copy.lightbox.disliked);
      return;
    }
    toggleDislike();
  }

  function triggerGesture(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (!photo) return;
    applyWrap(0, 0, true);
    if (dir === 'left' || dir === 'right') {
      if (dir === 'left') markLike();
      else markDislike();
      gestureDir = dir;
      gestureRatio = 1;
      setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
        onNavigate?.(currentIndex < photos.length - 1 ? currentIndex + 1 : 0);
      }, 200);
    } else if (dir === 'down') {
      onDownload?.(photo);
      toast.success(copy.lightbox.downloadStarted);
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
    if (dist >= triggerAt) {
      const dir = ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      triggerGesture(dir as 'left' | 'right' | 'up' | 'down');
      return;
    }

    // Below the threshold: spring back.
    gestureDir = null;
    gestureRatio = 0;
    applyWrap(0, 0, true);
  }

  function onDblClick(e: MouseEvent): void {
    // e.target is the capture element (pointer capture retargets click/dblclick
    // to the stage), so hit-test the point itself: only a dblclick landing on
    // the media may toggle zoom; bars/buttons/backdrop must not.
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit?.closest('.lb-media')) return;
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

  // Wrap-around: first and last photos are connected.
  function goPrev() {
    if (photos.length < 2) return;
    onNavigate?.(currentIndex > 0 ? currentIndex - 1 : photos.length - 1);
  }
  function goNext() {
    if (photos.length < 2) return;
    onNavigate?.(currentIndex < photos.length - 1 ? currentIndex + 1 : 0);
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
    // New photo: reset loaded/failure state so the skeleton shows until decode.
    loadedUrl = '';
    failController?.abort();
    failController = null;
    loadFailed = false;
    failStatus = '404';
    if (wrapEl) applyWrap();
  });

  // Preload the two neighbours so switching feels instant, wrapping around the ends.
  // Only still images warm via `new Image()` — ANIMATED/VIDEO are real video and
  // preloading those is expensive. Two things this effect deliberately does NOT do:
  //   • it never cancels a warm-up. `photos` is a brand-new array on every /sync, so a
  //     cleanup would abort downloads that are already in flight and start them over;
  //     `img.src = ''` can also fire a stray request at the document URL.
  //   • it does not warm while the viewer is closed. The Lightbox stays mounted, so
  //     without the `open` guard every page load would fetch neighbours for a viewer
  //     nobody opened.
  $effect(() => {
    if (!open) return;
    const len = photos.length;
    if (len < 2) return;
    const picks = [photos[(currentIndex - 1 + len) % len], photos[(currentIndex + 1) % len]];
    // Holds this run's elements until the next run — the standard preload idiom relies
    // on an unreferenced Image() still finishing, but keeping them is free insurance.
    const warm: HTMLImageElement[] = [];
    const seen = new Set<string>();
    for (const p of picks) {
      if (!p || p.type !== MEDIA_TYPE.IMAGE) continue;
      if (seen.has(p.url)) continue; // a two-photo set names the same neighbour twice
      seen.add(p.url);
      const img = new Image();
      img.src = p.url;
      warm.push(img);
      // Mirror the failure probe, so a neighbour that already 404s has its code cached
      // before the user ever navigates to it.
      if (!statusCache.has(p.url)) {
        fetch(p.url, { method: 'HEAD', cache: 'force-cache' })
          .then((res) => statusCache.set(p.url, res.ok ? 'ok' : String(res.status)))
          .catch(() => statusCache.set(p.url, '0'));
      }
    }
  });

  // <img>/<video> onerror does not expose the HTTP status; send a HEAD probe
  // to get the real code, show it in the glitch fallback, and surface a toast.
  // Uses the per-URL cache so a repeated failure is instant.
  function probeFailStatus(url: string) {
    const cached = statusCache.get(url);
    if (cached && cached !== 'ok') {
      failStatus = cached;
      toast.error(
        cached === '0'
          ? copy.lightbox.loadFailed
          : fmt(copy.lightbox.loadFailedStatus, { status: cached }),
      );
      return;
    }
    failController?.abort();
    failController = new AbortController();
    const ctrl = failController;
    fetch(url, { method: 'HEAD', cache: 'force-cache', signal: ctrl.signal })
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const s = String(res.status);
        statusCache.set(url, s);
        failStatus = s;
        toast.error(fmt(copy.lightbox.loadFailedStatus, { status: res.status }));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        statusCache.set(url, '0');
        failStatus = '0';
        toast.error(copy.lightbox.loadFailed);
      });
  }

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
      toast.error(copy.lightbox.copyFailed);
    }
  }

  /** Proxy URL for out-of-site sharing (host URLs never leave the Worker). */
  let shareUrl = $derived(photo ? proxyUrl(origin, photo.id) : '');

  /** Open transition: the element mounts inside `{#if open}` — mount without `.show`
   *  and add the class on the next frame, or the transition would not play. */
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
      await copyText(shareUrl, copy.lightbox.linkCopied);
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
        <Tooltip text={isLiked ? copy.lightbox.unlike : copy.lightbox.like} side="bottom">
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
        <Tooltip text={isDisliked ? copy.lightbox.undislike : copy.lightbox.dislike} side="bottom">
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
        <Tooltip
          text={isReported ? copy.lightbox.cancelReport : copy.lightbox.report}
          side="bottom"
        >
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
        <Tooltip text={copy.lightbox.more} side="bottom">
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10"
            onclick={() => (showMenu = true)}
          >
            <MoreHorizontal class="size-6" />
          </button>
        </Tooltip>
        <Tooltip text={copy.lightbox.close} side="bottom">
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
        <!-- Skeleton sized from the photo's metadata: native width/height (--w/--h)
             and aspect ratio (--ar) form the exact box the <img> renders into, so
             the skeleton caps at --w/--h, not just at the viewport budget. -->
        {#if loadedUrl !== photo.url}
          <div
            class="lb-skeleton {loadFailed ? 'lb-skeleton-solid' : ''}"
            style="--w: {photo.width}px; --h: {photo.height}px; --ar: {photo.width /
              photo.height}; aspect-ratio: {photo.width} / {photo.height};"
            aria-hidden="true"
          >
            {#if loadFailed}
              <GlitchText text={failStatus} size="clamp(4rem, 14vw, 9rem)" />
            {/if}
          </div>
        {/if}
        {#if photo.type !== 0}
          <!-- type=1 (silent WebM) and type=2 (video with audio) both use video -->
          <video
            src={photo.url}
            class="lb-media {loadedUrl === photo.url ? 'opacity-100' : 'opacity-0'}"
            draggable="false"
            muted={volumeMuted}
            loop
            autoplay
            playsinline
            onloadeddata={() => (loadedUrl = photo.url)}
            onerror={() => {
              loadFailed = true;
              probeFailStatus(photo.url);
            }}
          ></video>
        {:else}
          <img
            src={photo.url}
            alt=""
            class="lb-media {loadedUrl === photo.url ? 'opacity-100' : 'opacity-0'}"
            draggable="false"
            onload={() => (loadedUrl = photo.url)}
            onerror={() => {
              loadFailed = true;
              probeFailStatus(photo.url);
            }}
          />
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
      <Tooltip text={volumeMuted ? copy.lightbox.unmute : copy.lightbox.mute} side="left">
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
        <div class="tabular-nums text-white/55">
          <TimeLabel time={photo.createdAt} />
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Tooltip text={copy.lightbox.prev}>
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
            disabled={photos.length < 2}
            onclick={goPrev}
          >
            <ChevronLeft class="size-6" />
          </button>
        </Tooltip>
        <Tooltip text={copy.lightbox.next}>
          <button
            type="button"
            class="inline-flex size-11 items-center justify-center rounded-full text-white/80 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-white/10 disabled:opacity-30"
            disabled={photos.length < 2}
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
          void copyText(photo.url, copy.lightbox.originalUrlCopied);
          showMenu = false;
        }}
      >
        <Copy class="size-6" />
        <span class="text-sm">{copy.lightbox.copyOriginal}</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={() => {
          void copyText(shareUrl, copy.lightbox.linkCopied);
          showMenu = false;
        }}
      >
        <Link2 class="size-6" />
        <span class="text-sm">{copy.lightbox.copyLink}</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-muted"
        onclick={share}
      >
        <Share2 class="size-6" />
        <span class="text-sm">{copy.lightbox.share}</span>
      </button>

      <button
        type="button"
        class="flex flex-col items-center gap-2 rounded-xl p-4 text-primary transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:bg-primary/10"
        onclick={() => {
          window.open(
            `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(shareUrl)}`,
            '_blank',
          );
          showMenu = false;
        }}
      >
        <Search class="size-6" />
        <span class="text-sm">{copy.lightbox.googleLens}</span>
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
        <span class="text-sm">{isReported ? copy.lightbox.cancelDelete : copy.lightbox.report}</span
        >
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
        <span class="text-sm">{copy.lightbox.download}</span>
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
          <span class="text-sm">{copy.lightbox.delete}</span>
        </button>
      {/if}
    </div>
  </ActionSheet>
{/if}

<style>
  .lb-meta {
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
  }

  /* Media sizing: vertical space for the bars, horizontal margins on narrow screens (also the
     edge-gesture area); only max-h-screen + max-w-full degrades to native pixels. */
  .lb-media {
    max-width: calc(100vw - 2.5rem);
    max-height: calc(100dvh - 8rem);
    border-radius: 14px;
    object-fit: contain;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;
  }

  /* Skeleton placeholder sized from the photo's metadata while media decodes.
     The <img> never scales past native pixels, so width = min(--w, viewport width
     budget, viewport height budget * aspect ratio) — the revealed media's box. */
  .lb-skeleton {
    position: absolute;
    /* Centred on the wrapper's centre rather than with `inset: 0; margin: auto`: the
       wrapper holds the media itself and collapses to 0×0 until that media has an
       intrinsic size, and `margin: auto` cannot centre a box bigger than its
       containing block — it pinned the skeleton's left/top edge to the centre and let
       the rest overflow right/down (the off-centre panel). Percent + translate is
       immune to the container's size. */
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(var(--w), calc(100vw - 2.5rem), calc((100dvh - 8rem) * var(--ar, 1)));
    max-width: calc(100vw - 2.5rem);
    max-height: calc(100dvh - 8rem);
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      90deg,
      var(--color-card) 0%,
      var(--color-surface-top) 40%,
      var(--color-card) 80%
    );
    background-size: 800px 100%;
    animation: shimmer 1.8s infinite ease-in-out;
    border-radius: 14px;
  }

  /* On load failure: drop the shimmer, keep a flat solid surface behind the glitch code. */
  .lb-skeleton-solid {
    background: var(--color-card);
    animation: none;
  }

  @media (min-width: 768px) {
    .lb-skeleton {
      width: min(var(--w), calc(100vw - 8rem), calc((100dvh - 9rem) * var(--ar, 1)));
      max-width: calc(100vw - 8rem);
      max-height: calc(100dvh - 9rem);
    }
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
