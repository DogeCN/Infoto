/**
 * Lightbox gesture/transform engine — pure, DOM-free math.
 *
 * The `<Lightbox>` component owns the event wiring and DOM writes; this module
 * owns the geometry. Keeping it pure makes the gesture fixes (pinch anchor,
 * rect-based pan clamp, viewport-overflow gate, rotation snap, double-tap and
 * swipe classification) unit-testable instead of buried in a 1200-line Svelte
 * file.
 */

/**
 * Zoom bounds. The lower bound is **below 1 on purpose**: pinching apart and Ctrl+wheel-up
 * have to be able to make the media smaller than the stage, which is how you get back to a
 * whole-photo view after a pinch went too far. With `MIN_SCALE = 1` both of those were dead
 * inputs that silently did nothing, and the only way back to fit was double-click.
 *
 * Note what "zoomed in" means everywhere below: `scale > REST_SCALE + REST_EPSILON`, never
 * `scale > MIN_SCALE`. A 0.8 image is smaller than the stage, so it must centre and refuse to
 * pan — the same resting behaviour scale 1 gets.
 */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 5;

/** Above this the media is treated as zoomed in; at or below it, it rests centred. */
export const REST_SCALE = 1;
/** Slack for the resting comparison, so a pinch settling at 1.0000001 still rests. */
export const REST_EPSILON = 0.01;

/** True when the media is at (or below) fit scale: centred, and not pannable. */
export function isAtRest(scale: number): boolean {
  return scale <= REST_SCALE + REST_EPSILON;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/**
 * An element's own box: `width`/`height` **excluding any transform**. Rendered
 * rects are not usable for the pan clamp because they reflect whatever the
 * transform currently interpolates to — measuring mid-transition reads the frame
 * the gesture came *from*, see `clampPan`.
 */
export interface Box {
  width: number;
  height: number;
}

export interface ZoomState {
  scale: number;
  zoomX: number;
  zoomY: number;
  rot: number;
}

/** Geometry captured when a two-finger pinch begins. */
export interface PinchStart {
  dist: number;
  angle: number;
  s: number;
  x: number;
  y: number;
  r: number;
}

/** Geometry captured when a desktop Ctrl+drag (zoom + rotate) begins. The pivot is a
 *  fixed centre — the card centre, which sits at the stage centre at rest — so the gesture
 *  scales and rotates the image about that point. `dist0`/`angle0` are the pointer's distance
 *  from and angle around that centre at the moment the gesture starts. */
export interface CtrlZoomStart {
  scale0: number;
  dist0: number;
  angle0: number;
  /** Rotation in force when the gesture began. Used as the base the angle delta adds to. */
  r: number;
}

export interface Tap {
  t: number;
  x: number;
  y: number;
}

export type SwipeDir = 'left' | 'right' | 'up' | 'down';

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** A rotation that is not axis-aligned (0/180/360°) keeps the image pannable. */
export function isRotated(rot: number): boolean {
  const r = Math.abs(rot) % 360;
  const TOL = 0.5;
  return !(r <= TOL || Math.abs(r - 180) <= TOL || Math.abs(r - 360) <= TOL);
}

/** Normalise an angle delta into (-180, 180] to avoid 179°↔-179° jumps. */
export function normAngle(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

/** Snap a rotation to the nearest 90°, preserving its signed quadrant. */
export function snapRotation(rot: number): number {
  return Math.round(rot / 90) * 90;
}

/**
 * Pan clamp using the *actual* rendered wrap size, not the stage dimensions.
 *
 * The allowed offset on an axis is half the overflow: a wrap larger than the
 * stage may move until an edge meets the stage edge, and a wrap still smaller
 * than the stage (a small photo at 5x, or object-fit letterboxing) is pinned to
 * the centre. Pinning to the centre — rather than trying to satisfy "no gap on
 * the left AND no gap on the right" — is what keeps a sub-viewport media box
 * from being slammed into a corner, because the two edge conditions can never
 * both hold when the media is the smaller of the two.
 */
/**
 * The axis-aligned bounds a `width × height` box occupies once rotated about its
 * own centre. Rotating a rectangle swaps its contribution per axis: at 90° the
 * width comes entirely from what was the height.
 */
export function rotatedBounds(width: number, height: number, rot: number): Box {
  const rad = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { width: width * c + height * s, height: width * s + height * c };
}

/**
 * Pan clamp from the wrap's **layout box**, scaled and rotated into the bounds it
 * will settle at — never from its rendered rect.
 *
 * The rendered rect is unusable here. When a zoom is animated the transform has
 * just been written but not yet interpolated, so `getBoundingClientRect` returns
 * the *starting* box: for a double-tap that is the un-zoomed media, still smaller
 * than the stage, so every bound collapses to 0 and the offset `zoomToPoint` had
 * just computed to anchor the zoom on your finger is clamped straight back out —
 * the photo zoomed from the middle however off-centre you tapped. Reading the
 * layout box instead sidesteps the transition entirely: `offsetWidth` ignores
 * transforms, so it already describes where the box lands.
 */
export function clampPan(state: ZoomState, stage: Box, box: Box): ZoomState {
  // Only force-centre when the media is at fit *and* unrotated. A rotated image
  // (even at fit scale) can have a bounding box that overflows the stage on an
  // axis, so it must stay pannable; forcing the offset to zero would freeze the
  // drag after a pure rotation.
  if (isAtRest(state.scale) && !isRotated(state.rot)) {
    return { ...state, zoomX: 0, zoomY: 0 };
  }
  const bounds = rotatedBounds(box.width * state.scale, box.height * state.scale, state.rot);
  const maxX = Math.max(0, (bounds.width - stage.width) / 2);
  const maxY = Math.max(0, (bounds.height - stage.height) / 2);
  return {
    ...state,
    zoomX: clampAxis(state.zoomX, maxX),
    zoomY: clampAxis(state.zoomY, maxY),
  };
}

/** Bound an offset to ±max, normalising the -0 that `Math.max(-0, v)` yields. */
function clampAxis(v: number, max: number): number {
  const bounded = Math.min(max, Math.max(-max, v));
  return bounded === 0 ? 0 : bounded;
}

/** True only when the rendered media actually overflows the viewport on an axis. */
export function isZoomedBeyondViewport(stage: Rect, wrap: Rect): boolean {
  return wrap.width > stage.width + 1 || wrap.height > stage.height + 1;
}

/**
 * Zoom to `ns` anchored at the stage-relative point (sx, sy). When rotated, the
 * anchor is pinned to the centre so the scale+translate math stays valid.
 * Returns the provisional state without empirical clamping — the caller writes
 * the transform, reads the new wrap rect, then passes it to `clampPan`.
 */
export function zoomToPoint(
  state: ZoomState,
  ns: number,
  sx: number,
  sy: number,
  stage: Rect,
): ZoomState {
  const s = clampScale(ns);
  const Sx = stage.width / 2;
  const Sy = stage.height / 2;
  const ax = isRotated(state.rot) ? Sx : sx;
  const ay = isRotated(state.rot) ? Sy : sy;
  const scale = state.scale;
  const x = state.zoomX;
  const y = state.zoomY;
  const zoomX = ax - Sx - (s * (ax - Sx - x)) / scale;
  const zoomY = ay - Sy - (s * (ay - Sy - y)) / scale;
  const next = { scale: s, zoomX, zoomY, rot: state.rot };
  return isAtRest(s) ? { ...next, zoomX: 0, zoomY: 0 } : next;
}

/**
 * Two-finger pinch recomputed every frame from the pinch-start geometry, so a
 * moving midpoint pushes the image to follow the fingers (no cumulative drift).
 * `p0`/`p1` are the two pointers in client coordinates; `stage` is the stage rect.
 */
export function pinchTransform(
  start: PinchStart,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  stage: Rect,
): ZoomState {
  const d = Math.hypot(p0.x - p1.x, p0.y - p1.y) || 1;
  const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  const cx = (p0.x + p1.x) / 2 - stage.left;
  const cy = (p0.y + p1.y) / 2 - stage.top;
  const ns = clampScale((d / start.dist) * start.s);
  const Sx = stage.width / 2;
  const Sy = stage.height / 2;
  const ax = isRotated(start.r) ? Sx : cx;
  const ay = isRotated(start.r) ? Sy : cy;
  const s = start.s;
  const x = start.x;
  const y = start.y;
  const zoomX = ax - Sx - (ns * (ax - Sx - x)) / s;
  const zoomY = ay - Sy - (ns * (ay - Sy - y)) / s;
  const rot = start.r + normAngle(angle - start.angle);
  return { scale: ns, zoomX, zoomY, rot };
}

/**
 * Desktop Ctrl+drag: the fixed card centre is the pivot. The pointer's distance from that
 * centre drives scale (ratio to the start distance); the pointer's angle around it drives
 * rotation (delta from the start angle). Because the pivot is the centre, the translate stays
 * zero — the image scales and spins about the stage centre, never drifting. Returns provisional
 * state (caller clamps empirically, though with zero offset there is nothing to clamp).
 */
export function ctrlZoomTransform(
  start: CtrlZoomStart,
  pointer: { x: number; y: number },
  center: { x: number; y: number },
): ZoomState {
  const distance = Math.max(12, Math.hypot(center.x - pointer.x, center.y - pointer.y));
  const ratio = distance / (start.dist0 || 1);
  const ns = clampScale(start.scale0 * ratio);
  const angle = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI;
  const rot = start.r + normAngle(angle - start.angle0);
  return { scale: ns, zoomX: 0, zoomY: 0, rot };
}

/** Classify a touch/mouse tap: a quick second tap near the first is a double. */
export function classifyTap(
  lastTap: Tap | null,
  now: number,
  x: number,
  y: number,
  opts: { withinMs?: number; withinPx?: number } = {},
): 'double' | 'single' {
  const withinMs = opts.withinMs ?? 300;
  const withinPx = opts.withinPx ?? 40;
  if (
    lastTap &&
    now - lastTap.t < withinMs &&
    Math.hypot(x - lastTap.x, y - lastTap.y) < withinPx
  ) {
    return 'double';
  }
  return 'single';
}

/** Map a drag displacement to a swipe direction, or null below the threshold. */
export function classifySwipe(dx: number, dy: number, triggerAt: number): SwipeDir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const dist = Math.max(ax, ay);
  if (dist < triggerAt) return null;
  return ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

/** How far a release may travel and still count as a tap, in px. */
export const TAP_SLOP = 12;

export type Release =
  | { kind: 'pinch-tail' }
  | { kind: 'pan-end' }
  | { kind: 'tap' }
  | { kind: 'swipe'; dir: SwipeDir }
  | { kind: 'none' };

/**
 * Classify the release of the pointer that empties the gesture.
 *
 * `pinchSequence` is the decisive input and the whole point of this function. A
 * pinch ends on the **first** finger lift, and the partner fingers are still down
 * afterwards. Judging their releases like a fresh drag measures them against a
 * press point captured during the pinch — for a two-finger zoom closed with both
 * fingers together, that is the distance *between the two fingers*, easily past
 * the swipe threshold, so zooming voted on the photo (and advanced, which also
 * resets the rotation — making the rotate gesture look like it never happened).
 * The reference implementation avoids it by ending the whole gesture on the
 * first lift and leaving the remaining fingers inert; this keeps that rule while
 * still letting a leftover finger pan an already-zoomed photo.
 */
export function classifyRelease(input: {
  /** A pinch happened in this multi-touch sequence and it has not fully ended. */
  pinchSequence: boolean;
  panning: boolean;
  dx: number;
  dy: number;
  triggerAt: number;
  isTouch: boolean;
}): Release {
  if (input.pinchSequence) return input.panning ? { kind: 'pan-end' } : { kind: 'pinch-tail' };

  // A tap outranks a pan, and the order is the whole point. Once the photo is
  // zoomed, every single-finger touch is already a pan to `onPointerMove`, so
  // judging the pan first meant a release could never be a tap again — and the
  // second tap of a double-tap-to-reset did nothing. Zooming in then worked (the
  // first double tap starts un-panned, where nothing has moved yet) while
  // zooming back out did not: double tap to enlarge, pinch to get back. Mouse
  // never showed it, because the desktop path is the native `dblclick` and never
  // reaches this state machine. A drag that actually moved is still a pan.
  if (input.isTouch && Math.hypot(input.dx, input.dy) < TAP_SLOP) return { kind: 'tap' };
  if (input.panning) return { kind: 'pan-end' };
  const dir = classifySwipe(input.dx, input.dy, input.triggerAt);
  return dir ? { kind: 'swipe', dir } : { kind: 'none' };
}

/** Black-mask navigation: left half → prev, right half → next. */
export function classifyClickNav(x: number, stageWidth: number): 'prev' | 'next' {
  return x < stageWidth / 2 ? 'prev' : 'next';
}
