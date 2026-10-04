<script lang="ts">
  import { overlay } from '$base/lib/overlay';
  // Full-screen media viewer with swipe actions, pinch and wheel zoom, drag panning, and keyboard controls.
  import { MEDIA_TYPE, type Photo } from '$shared/types';
  import { copy } from '$lib/i18n.svelte';
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
  import { proxyUrl } from '$shared/media';
  import { humanSize } from '$base/lib/format';
  import { copyToClipboard } from '$base/lib/clipboard';
  import ActionSheet from './ActionSheet.svelte';
  import TimeLabel from './TimeLabel.svelte';
  import Tooltip from './Tooltip.svelte';
  import TooltipIconButton from './TooltipIconButton.svelte';
  import {
    snapRotation,
    pinchTransform,
    ctrlZoomTransform,
    classifyTap,
    classifyRelease,
    classifyClickNav,
    clampPan as engineClampPan,
    isAtRest,
    isZoomedBeyondViewport as engineIsZoomedBeyondViewport,
    zoomToPoint as engineZoomToPoint,
    isRotated as engineIsRotated,
    type PinchStart,
    type Tap,
    type ZoomState,
  } from '$base/lib/lightboxEngine';

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
  /** Zoom bounds are imported from the lightbox engine (MIN_SCALE / MAX_SCALE). */

  let showMenu = $state(false);
  let volumeMuted = $state(true);
  // loadedUrl === photo.url means the current media finished decoding (drives skeleton + opacity).
  let loadedUrl = $state('');
  // Media load failure: the skeleton drops to a flat surface and a toast reports it.
  // The HTTP status is not reliably obtainable cross-origin (HEAD is CORS-gated).
  let loadFailed = $state(false);

  // Track which failing URLs have already surfaced a toast, so revisiting a
  // known-broken photo does not spam notifications.
  const failToastSeen = new Set<string>();

  let photo = $derived(photos[currentIndex]);
  let isLiked = $derived(photo?.likes.includes(selfId) ?? false);
  let isDisliked = $derived(photo?.dislikes.includes(selfId) ?? false);
  let isReported = $derived(photo?.reports.includes(selfId) ?? false);
  let origin = $derived(typeof window === 'undefined' ? '' : window.location.origin);

  // ---- gesture state (non-reactive: high-frequency pointer moves write the
  //      DOM directly to stay in sync) ----------------------------------------
  let stageEl = $state<HTMLElement | undefined>(undefined);
  let wrapEl = $state<HTMLElement | undefined>(undefined);
  /** The card-corner volume button, only present for type=2. */
  let cornerEl = $state<HTMLElement | undefined>(undefined);

  let scale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let rot = 0;
  let dragging = false;
  let panning = false;
  let gestureMoved = false;
  let pinchActive = false;
  let pinchStart: PinchStart | null = null;
  /** True from the first two-finger contact until every pointer of that sequence
   *  has left. While it holds the tail of the gesture may pan but must never be
   *  judged as a tap, a swipe or a mask click — see `classifyRelease`. */
  let pinchSequence = false;
  /** Touch double-tap bookkeeping (native dblclick is unreliable on touch). */
  let lastTap: Tap | null = null;
  let suppressClickUntil = 0;
  let ctrlZoomPointer: number | null = null;
  /** Fixed pivot for the Ctrl gesture: the card centre (stage centre at rest). */
  let ctrlZoomCenter = { x: 0, y: 0 };
  let ctrlZoomStartDist = 1;
  let ctrlZoomStartAngle = 0;
  let ctrlZoomStartScale = 1;
  let ctrlZoomStartRot = 0;
  /** True while Ctrl is held; lets a plain drag switch into the Ctrl zoom/rotate mode. */
  let ctrlPressed = false;
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
    const transition = animate ? 'transform var(--duration-exit) var(--ease-exit)' : 'none';
    wrapEl.style.transition = transition;
    wrapEl.style.transform = `translate(${zoomX + dx}px, ${zoomY + dy}px) scale(${scale}) rotate(${rot}deg)`;
    // Counter-scale media controls while preserving their independent hover scale.
    wrapEl.style.setProperty('--inv', String(1 / scale));
    // Apply the same transform transition to media and counter-scaled controls.
    if (cornerEl) cornerEl.style.transition = transition;
  }

  function resetZoom(animate = false, keepRotate = false): void {
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    if (!keepRotate) rot = 0;
    applyWrap(0, 0, animate);
  }

  /**
   * Pan clamping: keep the rendered media box inside the stage. The geometry lives
   * in the lightbox engine; this supplies it with the wrap's **layout** box.
   *
   * Deliberately `offsetWidth`, not `getBoundingClientRect`: the rendered rect
   * follows the transform, and every animated zoom (double-tap, double-click, the
   * pinch release snap) writes the transform and clamps in the same frame, while
   * the transition has barely begun. The rect then still describes the *previous*
   * scale, every bound collapses to 0, and the anchor `zoomToPoint` computed so
   * the photo would grow out from your finger is discarded — the image zoomed
   * from its centre instead. `offsetWidth` ignores transforms, so it already is
   * the size the box is heading for.
   */
  function clampPan(): void {
    if (!stageEl || !wrapEl) return;
    const sr = stageEl.getBoundingClientRect();
    const next = engineClampPan(
      { scale, zoomX, zoomY, rot },
      { width: sr.width, height: sr.height },
      { width: wrapEl.offsetWidth, height: wrapEl.offsetHeight },
    );
    zoomX = next.zoomX;
    zoomY = next.zoomY;
  }

  /** Whether the rendered media actually overflows the viewport on some axis —
   *  the correct gate for entering pan mode. */
  function isZoomedBeyondViewport(): boolean {
    if (!stageEl || !wrapEl) return false;
    const sr = stageEl.getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    return engineIsZoomedBeyondViewport(sr, wr);
  }

  /** A rotation that is not axis-aligned (0/180/360°) — such images should pan. */
  function isRotated(): boolean {
    return engineIsRotated(rot);
  }

  /** Capture the pinch-start geometry (distance, angle, and current zoom state). */
  function startPinch(): void {
    const [a, b] = [...active.values()];
    if (!a || !b || !stageEl) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    pinchActive = true;
    pinchSequence = true;
    pinchStart = { dist: d, angle, s: scale, x: zoomX, y: zoomY, r: rot };
  }

  /** Clamp the state that is on screen *now*, rewriting the transform only if the
   *  clamp actually moved it. This must always run after the write that produced the
   *  rects: `clampPan` reads the rendered box, so judging it before the write measures
   *  the previous frame's geometry, which is by definition still legal — and the new
   *  value then escapes unclamped.
   *
   *  No "skip while at rest" escape hatch: `clampPan` collapses the offset itself when
   *  the media is at or below fit scale, and that collapse is exactly what a pinch-out
   *  past 1 needs. Skipping it left the media parked off-centre at, say, 0.8 — a state
   *  reachable only because `MIN_SCALE` is now below 1. */
  function clampSettled(animate: boolean): void {
    if (!stageEl || !wrapEl) return;
    const beforeX = zoomX;
    const beforeY = zoomY;
    clampPan();
    if (zoomX !== beforeX || zoomY !== beforeY) applyWrap(0, 0, animate);
  }

  /** Write a provisional transform, then clamp against the *newly rendered*
   *  rects and write again. Clamping before the write would judge the previous
   *  frame's geometry, which is already legal, so the new value escaped
   *  unclamped on every move. `animate` eases the step (used for double-tap/dblclick,
   *  not for the continuous wheel/pinch/Ctrl gestures). */
  function commitZoom(next: ZoomState, animate = false): void {
    scale = next.scale;
    zoomX = next.zoomX;
    zoomY = next.zoomY;
    rot = next.rot;
    applyWrap(0, 0, animate);
    clampSettled(animate);
  }

  /** Zoom to `ns` anchored at the stage-relative point (sx, sy); when rotated,
   *  pin the anchor to the centre so the scale+translate math stays valid. */
  function zoomToPoint(ns: number, sx: number, sy: number, animate = false): void {
    if (!stageEl) return;
    const sr = stageEl.getBoundingClientRect();
    commitZoom(engineZoomToPoint({ scale, zoomX, zoomY, rot }, ns, sx, sy, sr), animate);
  }

  /** Page-width-proportional thresholds: `base` is defined for a 768px-wide
   *  viewport and scales linearly with the page width — no device clamping, so
   *  wide screens need a proportionally longer drag instead of a touch. */
  function scaledThreshold(base: number): number {
    const w = typeof window === 'undefined' ? 768 : window.innerWidth;
    return Math.round((base * w) / 768);
  }

  function onPointerDown(e: PointerEvent) {
    if (showMenu || ctrlZoomPointer !== null || e.button !== 0) return;
    hintAt = scaledThreshold(HINT_THRESHOLD);
    triggerAt = scaledThreshold(SWIPE_THRESHOLD);

    if (e.pointerType === 'mouse' && e.ctrlKey && (e.target as Element).closest('.lb-box')) {
      beginCtrlZoom(e.pointerId, e.clientX, e.clientY, e.currentTarget as HTMLElement);
      e.preventDefault();
      return;
    }

    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 1) {
      dragging = true;
      gestureMoved = false;
      downPoint = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } else if (active.size === 2) {
      // Second pointer: start a pinch; clear any drag preview.
      startPinch();
      dragging = false;
      gestureDir = null;
      gestureRatio = 0;
      applyWrap();
    }
  }

  /**
   * Enter the desktop Ctrl zoom/rotate mode for `pointerId`. The pivot is the card centre
   * (stage centre at rest) and stays fixed: the image scales and rotates about it. The gesture
   * starts from the *current* scale/rotation and the pointer's present distance/angle, so
   * entering mid-drag (Ctrl pressed after the press) produces no jump. The pan is zeroed so
   * the pivot is exactly the stage centre.
   */
  function beginCtrlZoom(
    pointerId: number,
    clientX: number,
    clientY: number,
    target: HTMLElement | null,
  ): void {
    if (!wrapEl) return;
    const wrapRect = wrapEl.getBoundingClientRect();
    const center = {
      x: (wrapRect.left + wrapRect.right) / 2,
      y: (wrapRect.top + wrapRect.bottom) / 2,
    };
    ctrlZoomCenter = center;
    ctrlZoomStartDist = Math.max(12, Math.hypot(center.x - clientX, center.y - clientY));
    ctrlZoomStartAngle = (Math.atan2(clientY - center.y, clientX - center.x) * 180) / Math.PI;
    ctrlZoomStartScale = scale;
    ctrlZoomStartRot = rot;
    zoomX = 0;
    zoomY = 0;
    applyWrap();
    ctrlZoomPointer = pointerId;
    gestureDir = null;
    gestureRatio = 0;
    gestureMoved = true;
    active.set(pointerId, { x: clientX, y: clientY });
    target?.setPointerCapture?.(pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (ctrlZoomPointer === e.pointerId) {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      commitZoom(
        ctrlZoomTransform(
          {
            scale0: ctrlZoomStartScale,
            dist0: ctrlZoomStartDist,
            angle0: ctrlZoomStartAngle,
            r: ctrlZoomStartRot,
          },
          { x: e.clientX, y: e.clientY },
          ctrlZoomCenter,
        ),
        false,
      );
      gestureMoved = true;
      return;
    }
    if (!active.has(e.pointerId)) return;
    const start = active.get(e.pointerId)!;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (active.size >= 2) {
      // Pinch: zoom + rotate around the two-finger midpoint, recomputed every
      // frame from the pinch-start state so there is no cumulative drift.
      if (!pinchActive) startPinch();
      if (pinchStart) {
        const [a, b] = [...active.values()];
        const sr = stageEl!.getBoundingClientRect();
        const next = pinchTransform(pinchStart, a, b, sr);
        scale = next.scale;
        zoomX = next.zoomX;
        zoomY = next.zoomY;
        rot = next.rot;
        gestureMoved = true;
        applyWrap();
      }
      return;
    }

    if (!dragging) return;
    if (Math.abs(e.clientX - downPoint.x) > 4 || Math.abs(e.clientY - downPoint.y) > 4)
      gestureMoved = true;

    if (panning || isZoomedBeyondViewport() || isRotated()) {
      // Zoomed: dragging pans, accumulating with each move.
      panning = true;
      commitZoom({ scale, zoomX: zoomX + dx, zoomY: zoomY + dy, rot });
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

  let gestureTimer: ReturnType<typeof setTimeout> | undefined;
  // Cancel a pending gesture advance when the viewer closes or the photo
  // switches. This deliberately keys on the (stable) index and open flag rather
  // than the photo: marking a photo replaces its entry in the store while
  // keeping the same sha, which changed the `photo` object identity, re-ran this
  // effect and cleared the 200 ms advance timer — so a swipe marked the photo
  // but sometimes never advanced until the next swipe.
  $effect(() => {
    void open;
    void currentIndex;
    return () => clearTimeout(gestureTimer);
  });

  function triggerGesture(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (!photo) return;
    clearTimeout(gestureTimer);
    applyWrap(0, 0, true);
    if (dir === 'left' || dir === 'right') {
      if (dir === 'left') markLike();
      else markDislike();
      gestureDir = dir;
      gestureRatio = 1;
      gestureTimer = setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
        onNavigate?.(currentIndex < photos.length - 1 ? currentIndex + 1 : 0);
      }, 200);
    } else if (dir === 'down') {
      onDownload?.(photo);
      toast.success(copy.lightbox.downloadStarted);
      gestureDir = dir;
      gestureRatio = 1;
      gestureTimer = setTimeout(() => {
        gestureDir = null;
        gestureRatio = 0;
      }, 250);
    } else {
      // The up gesture has no auto-advance timer, so the hint drawn during the
      // drag would otherwise stay on screen behind the sheet that just opened.
      gestureDir = null;
      gestureRatio = 0;
      showMenu = true;
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (ctrlZoomPointer === e.pointerId) {
      active.delete(e.pointerId);
      ctrlZoomPointer = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragging = false;
      panning = false;
      // Snap the free rotation to the nearest 90° on release (matches the pinch
      // path). The pivot stays centred, so the snap only re-orients the image.
      rot = snapRotation(rot);
      applyWrap(0, 0, true);
      clampSettled(true);
      return;
    }
    const start = active.get(e.pointerId);
    active.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    // Pinch: end on the first finger lift, snap rotation to the nearest 90°
    // (keeping the signed value so a -90° gesture does not spin a full turn),
    // and clamp. A remaining finger may keep panning an already-zoomed photo,
    // but it is deliberately *not* re-armed as a fresh drag: re-arming it is what
    // let the two fingers' release points be measured against each other and
    // voted as a swipe.
    if (pinchActive && active.size < 2) {
      pinchActive = false;
      rot = snapRotation(rot);
      gestureMoved = true;
      if (active.size === 1) {
        const [rem] = [...active.values()];
        downPoint = { x: rem.x, y: rem.y };
        const canPan = isZoomedBeyondViewport() || isRotated();
        dragging = canPan;
        panning = canPan;
      } else {
        dragging = false;
        panning = false;
      }
      // Write the snapped rotation *before* clamping. Snapping moves the box's edges
      // by tens of pixels, so clamping against the pre-snap rect is how the image used
      // to settle out of frame at an angle it was no longer rendered at.
      applyWrap(0, 0, true);
      clampSettled(true);
      if (active.size === 0) pinchSequence = false;
      return;
    }

    if (active.size > 0) return; // A pointer is still down; wait for it.

    dragging = false;
    const wasPanning = panning;
    panning = false;
    const tail = pinchSequence;
    pinchSequence = false;

    if (!start) {
      applyWrap(0, 0, true);
      return;
    }
    // Total displacement from the press point (same reference as the drag preview).
    const dx = e.clientX - downPoint.x;
    const dy = e.clientY - downPoint.y;

    const release = classifyRelease({
      pinchSequence: tail,
      panning: wasPanning,
      dx,
      dy,
      triggerAt,
      isTouch: e.pointerType === 'touch',
    });

    // The tail of a pinch is never a vote, a download or a menu. Closing a two-finger
    // zoom used to land here with `dx` spanning the gap between the two fingers — far
    // past the threshold — so zooming marked the photo and advanced, which also reset
    // the rotation and made the rotate gesture look like it never happened.
    if (release.kind === 'pinch-tail') {
      lastTap = null;
      gestureDir = null;
      gestureRatio = 0;
      applyWrap(0, 0, true);
      clampSettled(true);
      return;
    }

    // Zoomed/rotated drag ends: clamp and settle in place.
    if (release.kind === 'pan-end') {
      applyWrap(0, 0, true);
      clampSettled(true);
      return;
    }

    if (release.kind === 'swipe') {
      triggerGesture(release.dir);
      return;
    }

    // Touch tap: detect a double-tap on the media to toggle zoom (native dblclick
    // is unreliable on touch, so it is handled here; the mouse path keeps onDblClick).
    if (release.kind === 'tap') {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit?.closest('.lb-media') && !hit.closest('.lb-corner, button')) {
        const now = Date.now();
        if (classifyTap(lastTap, now, e.clientX, e.clientY) === 'double') {
          if (!isAtRest(scale)) resetZoom(true, true);
          else {
            const r = stageEl!.getBoundingClientRect();
            zoomToPoint(2, e.clientX - r.left, e.clientY - r.top, true);
          }
          lastTap = null;
          suppressClickUntil = now + 400;
          return;
        }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }

    // Below the threshold: spring back.
    gestureDir = null;
    gestureRatio = 0;
    applyWrap(0, 0, true);
  }

  /**
   * A cancelled gesture is not a finished one.
   *
   * This used to be bound to `onPointerUp`, which ran the whole completion path: a system
   * takeover (incoming call, edge-back, app switch, a second touch stealing the gesture)
   * could mark a photo, start a download or open the menu that the user never asked for —
   * and vote on it, which is a server write. Cancelling drops the gesture state, snaps any
   * in-flight rotation to a resting angle so the photo is not left tilted, and returns the
   * transform without animating: nothing was completed, so there is nothing to settle.
   */
  function onPointerCancel(e: PointerEvent): void {
    active.delete(e.pointerId);
    if (ctrlZoomPointer === e.pointerId) ctrlZoomPointer = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    // One finger of a pinch being cancelled ends the pinch exactly as a release
    // would: snap the rotation and settle. Clearing `pinchActive` without that left
    // the partner finger to be judged as a swipe from the *original* press point —
    // a system takeover mid-zoom then voted on the photo, on top of losing the zoom.
    if (pinchActive) {
      pinchActive = false;
      rot = snapRotation(rot);
      applyWrap(0, 0, true);
      clampSettled(true);
    }

    // Partner fingers are still down: the gesture is not over. Nothing resets yet
    // and the leftover pointers stay inert — they may pan, never swipe.
    if (active.size > 0) {
      const canPan = isZoomedBeyondViewport() || isRotated();
      dragging = canPan;
      panning = canPan;
      return;
    }

    pinchSequence = false;
    pinchStart = null;
    dragging = false;
    panning = false;
    gestureMoved = false;
    lastTap = null;
    gestureDir = null;
    gestureRatio = 0;
    rot = snapRotation(rot);
    scale = 1;
    zoomX = 0;
    zoomY = 0;
    applyWrap();
  }

  function onDblClick(e: MouseEvent): void {
    // Mouse double-click zooms around the cursor; hit-test against media.
    // Guarded so a touch double-tap handled in onPointerUp is not doubled.
    if (Date.now() < suppressClickUntil) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit?.closest('.lb-media')) return;
    if (showMenu || gestureMoved) return;
    if (!isAtRest(scale)) resetZoom(true, true);
    else {
      const r = stageEl!.getBoundingClientRect();
      zoomToPoint(2, e.clientX - r.left, e.clientY - r.top, true);
    }
  }

  /** Desktop wheel zoom; passive:false is required to stop the page/browser zoom,
   *  bound through an action. Anchored on the cursor, like every other zoom path here —
   *  a wheel that zooms about the stage centre slides whatever sits under the pointer
   *  toward the middle on each tick, so the detail you are scrolling toward never stays put.
   *  Plain wheel and Ctrl+wheel both zoom (a trackpad pinch arrives as Ctrl+wheel). */
  function wheelZoom(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sr = stageEl?.getBoundingClientRect();
      if (!sr) return;
      zoomToPoint(scale - e.deltaY * 0.002, e.clientX - sr.left, e.clientY - sr.top, false);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      },
    };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open || e.defaultPrevented) return;
    if (e.key === ' ' && (e.target as HTMLElement).closest('button, a, input, textarea')) return;

    // Ctrl is the desktop zoom/rotate modifier. Pressing it mid-drag switches the plain
    // drag into the Ctrl mode (fixed-centre zoom + rotate) so you can start the gesture
    // any time, not only with Ctrl held at the press. The modifier's own keydown used to
    // reset the zoom, which fought the "press Ctrl to begin" flow and is removed.
    if (e.key === 'Control') {
      if (!ctrlPressed) {
        ctrlPressed = true;
        if (active.size >= 1 && !ctrlZoomPointer && dragging && !panning) {
          const [pid, p] = [...active.entries()][0];
          beginCtrlZoom(pid, p.x, p.y, null);
        }
      }
      return;
    }

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
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'Control') ctrlPressed = false;
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

  function handleStageClick(event: MouseEvent): void {
    if (showMenu || gestureMoved) return;
    // Swallow the click that follows a touch double-tap zoom.
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      return;
    }
    // The pointer is captured by the stage, so `event.target` is always the
    // stage — never the media or a control. Hit-test the point instead, or a
    // click on the card would page like a click on the black mask. Hit-testing
    // respects the zoom transform, so the media's *rendered* box is what counts.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (
      !hit ||
      hit.closest('button, a, input, textarea, select, [data-lb-controls], [data-lb-media]')
    )
      return;
    const width = stageEl?.clientWidth ?? window.innerWidth;
    if (classifyClickNav(event.clientX, width) === 'prev') goPrev();
    else goNext();
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
    rot = 0;
    // Reset load errors on photo changes while keeping the URL-based decoded-media cache.
    loadFailed = false;
    if (wrapEl) applyWrap();
  });

  // Preload adjacent still images while open. Video buffering is owned by the displayed media element.
  $effect(() => {
    if (!open) return;
    const len = photos.length;
    if (len < 2) return;
    const picks = [photos[(currentIndex - 1 + len) % len], photos[(currentIndex + 1) % len]];
    // Keeps this run's warm-up promises alive until the next run: the fetch is
    // fire-and-forget, and the standard preload idiom relies on an unreferenced
    // resource still finishing.
    const warm: HTMLImageElement[] = [];
    const seen = new Set<string>();
    for (const p of picks) {
      if (!p) continue;
      if (seen.has(p.url)) continue; // a two-photo set names the same neighbour twice
      seen.add(p.url);
      if (p.type === MEDIA_TYPE.IMAGE) {
        const img = new Image();
        img.src = p.url;
        warm.push(img);
      }
      // Videos are deliberately skipped — see the note above.
    }
  });

  /** Surface a toast once per failing URL. The ERROR glitch is already shown by
   * the media element's onerror handler. */
  function toastLoadFailed(url: string) {
    if (failToastSeen.has(url)) return;
    failToastSeen.add(url);
    toast.error(copy.lightbox.loadFailed);
  }

  // ---- menu actions ----------------------------------------------------------

  async function copyText(text: string, label: string) {
    if (await copyToClipboard(text)) toast.success(label);
    else toast.error(copy.lightbox.copyFailed);
  }

  /** An optimistic upload entry: it has no server id yet, so anything addressed by id
   *  (the /l/ proxy link, the id36 file name) is unavailable until it lands. */
  let isPending = $derived(photo ? photo.id < 0 : false);
  let shareUrl = $derived(photo && !isPending ? proxyUrl(origin, photo.id) : '');

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
    if (!photo || !shareUrl) return;
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

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyUp} />

{#if open && photo}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={stageEl}
    role="dialog"
    aria-modal="true"
    aria-label={copy.lightbox.preview}
    tabindex="-1"
    data-autofocus
    use:overlay={{ enabled: open, onClose: () => onClose?.() }}
    class="fixed inset-0 z-70 touch-none bg-black/92 opacity-0 backdrop-blur-[8px] pointer-events-none invisible transition-[opacity,visibility] duration-[var(--duration-enter)] ease-[var(--ease-enter)]"
    class:show={shown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    onclick={handleStageClick}
    ondblclick={onDblClick}
    use:wheelZoom
  >
    <!-- Top bar info: bare text top-left, more/close top-right -->
    <div
      data-lb-controls
      class="absolute inset-x-3 top-3 z-10 flex items-start justify-between md:inset-x-4 md:top-4"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="lb-meta flex items-center gap-3 text-base">
        <Tooltip text={isLiked ? copy.lightbox.unlike : copy.lightbox.like} side="bottom">
          <button
            aria-label={isLiked ? copy.lightbox.unlike : copy.lightbox.like}
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isLiked
              ? 'bg-destructive/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleLike}
          >
            <ThumbsUp class="size-5 {isLiked ? 'fill-current' : 'text-destructive'}" />
            <span class="tabular-nums">{photo.likes.length}</span>
          </button>
        </Tooltip>
        <Tooltip text={isDisliked ? copy.lightbox.undislike : copy.lightbox.dislike} side="bottom">
          <button
            aria-label={isDisliked ? copy.lightbox.undislike : copy.lightbox.dislike}
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isDisliked
              ? 'bg-dislike/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleDislike}
          >
            <ThumbsDown class="size-5 {isDisliked ? 'fill-current' : 'text-dislike'}" />
            <span class="tabular-nums">{photo.dislikes.length}</span>
          </button>
        </Tooltip>
        <Tooltip
          text={isReported ? copy.lightbox.cancelReport : copy.lightbox.report}
          side="bottom"
        >
          <button
            aria-label={isReported ? copy.lightbox.cancelReport : copy.lightbox.report}
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors duration-[var(--duration-exit)] ease-[var(--ease-exit)] {isReported
              ? 'bg-warning/85 text-white'
              : 'text-white/85 hover:bg-white/10'}"
            onclick={toggleReport}
          >
            <Flag class="size-5 {isReported ? 'fill-current' : 'text-warning'}" />
            <span class="tabular-nums">{photo.reports.length}</span>
          </button>
        </Tooltip>
      </div>

      <div class="flex items-center gap-0.5">
        <TooltipIconButton
          text={copy.lightbox.more}
          side="bottom"
          class="size-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          onclick={() => (showMenu = true)}
        >
          <MoreHorizontal class="size-6" />
        </TooltipIconButton>
        <TooltipIconButton
          text={copy.lightbox.close}
          side="bottom"
          class="size-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          onclick={onClose}
        >
          <X class="size-6" />
        </TooltipIconButton>
      </div>
    </div>

    <!-- Gesture transforms operate on the media wrapper; viewport margins preserve space for controls. -->
    <div class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        bind:this={wrapEl}
        data-lb-media
        class="relative flex max-w-full select-none items-center justify-center will-change-transform"
      >
        <!-- Size the placeholder from native dimensions and aspect ratio. -->
        {#if loadedUrl !== photo.url}
          <div
            class="lb-box lb-skeleton {loadFailed ? 'lb-skeleton-solid' : ''}"
            style="--w: {photo.width}px; --h: {photo.height}px; --ar: {photo.width /
              photo.height}; aspect-ratio: {photo.width} / {photo.height};"
            aria-hidden="true"
          ></div>
        {/if}
        {#if photo.type !== 0}
          <!-- Render silent and audio WebM with CSS sizing and eager buffering. -->
          <video
            src={photo.url}
            class="lb-box lb-media {loadedUrl === photo.url ? 'opacity-100' : 'opacity-0'}"
            style="--w: {photo.width}px; --ar: {photo.width} / {photo.height};"
            draggable="false"
            muted={volumeMuted}
            loop
            autoplay
            playsinline
            preload="auto"
            onloadeddata={() => (loadedUrl = photo.url)}
            onerror={() => {
              loadFailed = true;
              toastLoadFailed(photo.url);
            }}
          ></video>
        {:else}
          <img
            src={photo.url}
            alt=""
            class="lb-box lb-media {loadedUrl === photo.url ? 'opacity-100' : 'opacity-0'}"
            style="--w: {photo.width}px; --ar: {photo.width} / {photo.height};"
            draggable="false"
            onload={() => (loadedUrl = photo.url)}
            onerror={() => {
              loadFailed = true;
              toastLoadFailed(photo.url);
            }}
          />
        {/if}

        <!-- Anchor the counter-scaled volume control to the media corner. -->
        {#if photo.type === 2}
          <div class="lb-corner" bind:this={cornerEl}>
            <Tooltip text={volumeMuted ? copy.lightbox.unmute : copy.lightbox.mute} side="left">
              <button
                aria-label={volumeMuted ? copy.lightbox.unmute : copy.lightbox.mute}
                type="button"
                class="flex items-center justify-center rounded-full border backdrop-blur-[4px] transition-[background-color,border-color,color,scale] duration-[var(--duration-exit)] ease-[var(--ease-exit)] hover:scale-105 active:scale-95 {volumeMuted
                  ? 'border-white/15 bg-black/55 text-white/70 hover:bg-primary/20'
                  : 'border-primary/50 bg-primary/20 text-primary'}"
                style="width: 1.9rem; height: 1.9rem"
                onpointerdown={(e) => e.stopPropagation()}
                ondblclick={(e) => e.stopPropagation()}
                onclick={() => (volumeMuted = !volumeMuted)}
              >
                {#if volumeMuted}
                  <VolumeX class="size-4 text-warning" />
                {:else}
                  <Volume2 class="size-4" />
                {/if}
              </button>
            </Tooltip>
          </div>
        {/if}
      </div>
    </div>

    <!-- Direction gesture hints: fade and scale with the drag ratio -->
    {#if gestureDir}
      {#if gestureDir === 'left'}
        <div
          class="pointer-events-none absolute left-10 top-1/2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-destructive backdrop-blur-sm md:left-16"
          style="opacity: {gestureRatio}; transform: translateY(-50%) scale({0.8 +
            gestureRatio * 0.4})"
        >
          <ThumbsUp class="size-6" />
        </div>
      {:else if gestureDir === 'right'}
        <div
          class="pointer-events-none absolute right-10 top-1/2 z-10 flex size-14 items-center justify-center rounded-full bg-black/40 text-dislike backdrop-blur-sm md:right-16"
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

    <!-- Bottom bar info: dimensions/size bottom-left, prev/next bottom-right -->
    <div
      data-lb-controls
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
        <TooltipIconButton
          text={copy.lightbox.prev}
          class="size-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          disabled={photos.length < 2}
          onclick={goPrev}
        >
          <ChevronLeft class="size-6" />
        </TooltipIconButton>
        <span class="lb-meta min-w-14 text-center text-xs tabular-nums text-white/80">
          {currentIndex + 1} / {photos.length}
        </span>
        <TooltipIconButton
          text={copy.lightbox.next}
          class="size-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          disabled={photos.length < 2}
          onclick={goNext}
        >
          <ChevronRight class="size-6" />
        </TooltipIconButton>
      </div>
    </div>
  </div>

  <!-- More menu (bottom action sheet) -->
  <ActionSheet
    ariaLabel={copy.lightbox.actions}
    bind:open={showMenu}
    onClose={() => (showMenu = false)}
  >
    <div class="grid grid-cols-3 gap-3">
      <button
        type="button"
        class="photo-action text-sky-400 hover:bg-sky-400/15"
        onclick={() => {
          void copyText(photo.url, copy.lightbox.originalUrlCopied);
          showMenu = false;
        }}
      >
        <Copy class="size-6" />
        <span class="text-sm">{copy.lightbox.copyOriginal}</span>
      </button>

      <!-- Everything addressed by the photo's server id (the /l/ link, the id36 file
           name) waits until an optimistic upload lands; a pending card offers only what
           works without an id. -->
      {#if !isPending}
        <button
          type="button"
          class="photo-action text-violet-400 hover:bg-violet-400/15"
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
          class="photo-action text-teal-400 hover:bg-teal-400/15"
          onclick={share}
        >
          <Share2 class="size-6" />
          <span class="text-sm">{copy.lightbox.share}</span>
        </button>

        <a
          href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          class="photo-action text-primary hover:bg-primary/15"
          onclick={() => (showMenu = false)}
        >
          <Search class="size-6" />
          <span class="text-sm">{copy.lightbox.googleLens}</span>
        </a>
      {/if}

      <button
        type="button"
        class="photo-action text-amber-500 hover:bg-amber-500/15"
        onclick={() => {
          onRequestDelete?.(photo);
          showMenu = false;
        }}
      >
        <Flag class="size-6" />
        <span class="text-sm">{isReported ? copy.lightbox.cancelDelete : copy.lightbox.report}</span
        >
      </button>

      {#if !isPending}
        <button
          type="button"
          class="photo-action text-success hover:bg-success/15"
          onclick={() => {
            onDownload?.(photo);
            showMenu = false;
          }}
        >
          <Download class="size-6" />
          <span class="text-sm">{copy.lightbox.download}</span>
        </button>
      {/if}

      {#if selfId === 0}
        <button
          type="button"
          class="photo-action text-destructive hover:bg-destructive/15"
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
  .photo-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.75rem;
    padding: 1rem;
    transition:
      background-color var(--duration-exit) var(--ease-exit),
      color var(--duration-exit) var(--ease-exit);
  }

  .lb-meta {
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
  }

  /* Media sizing: vertical space for the bars, horizontal margins on narrow screens (also the
     edge-gesture area); only max-h-screen + max-w-full degrades to native pixels. */
  .lb-media {
    /* Share metadata-derived CSS sizing between media and skeleton to reserve the final box before decoding. */
    max-height: calc(100dvh - 8rem);
    aspect-ratio: var(--ar, auto);
    border-radius: var(--radius-card);
    object-fit: contain;
    transition:
      opacity var(--duration-enter) var(--ease-enter),
      transform var(--duration-enter) var(--ease-enter);
  }

  /* Media and placeholder dimensions, constrained by native size and viewport space. */
  .lb-box {
    width: min(var(--w), calc(100vw - 2.5rem), calc((100dvh - 8rem) * var(--ar, 1)));
    max-width: calc(100vw - 2.5rem);
  }

  /* Metadata-sized placeholder while media decodes. */
  .lb-skeleton {
    position: absolute;
    /* Center the skeleton independently of its containing block size. */
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-height: calc(100dvh - 8rem);
    display: flex;
    align-items: center;
    justify-content: center;
    /* Establish a size container so the ERROR glitch can scale to the media box
       via cqmin instead of a fixed font-size (which overflowed narrow media). */
    container-type: size;
    background: var(--shimmer-gradient);
    background-size: var(--shimmer-size);
    animation: shimmer var(--shimmer-duration) infinite ease-in-out;
    border-radius: var(--radius-card);
  }

  /* On load failure: drop the shimmer, keep a flat solid surface behind the glitch code. */
  .lb-skeleton-solid {
    background: var(--color-card);
    animation: none;
  }

  /* Anchor the volume control to the media corner and counter-scale it during zoom. */
  .lb-corner {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    z-index: 10;
    line-height: 0;
    transform: scale(var(--inv, 1));
    transform-origin: bottom right;
  }

  /* Wide viewports leave more breathing room around the bars, so the same formula runs
     with the larger budget — once, for the box both the media and the skeleton use. */
  @media (min-width: 768px) {
    .lb-box {
      width: min(var(--w), calc(100vw - 8rem), calc((100dvh - 9rem) * var(--ar, 1)));
      max-width: calc(100vw - 8rem);
    }

    .lb-skeleton,
    .lb-media {
      max-height: calc(100dvh - 9rem);
    }
  }

  .show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
</style>
