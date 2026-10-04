import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  isRotated,
  normAngle,
  snapRotation,
  clampPan,
  isAtRest,
  isZoomedBeyondViewport,
  zoomToPoint,
  pinchTransform,
  ctrlZoomTransform,
  classifyTap,
  classifySwipe,
  rotatedBounds,
  classifyRelease,
  classifyClickNav,
  type Rect,
  type Box,
} from '../../src/base/lib/lightboxEngine.ts';

const stage: Rect = { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };
/** The wrap's *layout* box: its size before any transform. */
const boxOf = (width: number, height: number): Box => ({ width, height });
const at = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

test('clampScale bounds the zoom', () => {
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(9), MAX_SCALE);
  assert.equal(clampScale(2.3), 2.3);
});

test('the zoom range allows zooming out, and resting is not the lower bound', () => {
  // Pinching apart and Ctrl+wheel-up have to be able to make the media smaller than the
  // stage. A MIN_SCALE of 1 made both dead inputs: they computed a value, got clamped back
  // to 1, and the image never moved. Regression guard for that, not a restatement.
  assert.ok(MIN_SCALE < 1, 'the media must be able to be shown smaller than it fits');
  assert.equal(clampScale(0.6), 0.6, 'a sub-fit scale is a legal zoom target');
  // "At rest" is about fit, not about the clamp: a 0.8 image is smaller than the stage, so
  // it centres and refuses to pan exactly like a 1.0 one does.
  assert.equal(isAtRest(0.8), true);
  assert.equal(isAtRest(1), true);
  assert.equal(isAtRest(1.005), true);
  assert.equal(isAtRest(1.02), false);
});

test('isRotated flags only non-axis-aligned angles', () => {
  assert.equal(isRotated(0), false);
  assert.equal(isRotated(180), false);
  assert.equal(isRotated(360), false);
  assert.equal(isRotated(90), true);
  assert.equal(isRotated(-45), true);
  assert.equal(isRotated(0.4), false);
  // 179.6° is essentially 180° (upside down), which is axis-aligned.
  assert.equal(isRotated(179.6), false);
  assert.equal(isRotated(135), true);
});

test('normAngle avoids the 179°↔-179° jump', () => {
  assert.equal(normAngle(90), 90);
  assert.equal(normAngle(-90), -90);
  assert.equal(normAngle(200), -160);
  assert.equal(normAngle(-200), 160);
  // A pinch rotating from 170° to -170° should be +20°, not -340°.
  assert.equal(normAngle(-170 - 170), 20);
});

test('snapRotation lands on the nearest 90° keeping sign', () => {
  assert.equal(snapRotation(30), 0);
  assert.equal(snapRotation(60), 90);
  assert.equal(snapRotation(89), 90);
  // snapRotation(-30) is mathematically 0; assert via === because Object.is(-0, 0) is false.
  assert.ok(snapRotation(-30) === 0);
  assert.equal(snapRotation(-60), -90);
  assert.equal(snapRotation(-89), -90);
  assert.equal(snapRotation(179), 180);
  assert.equal(snapRotation(-179), -180);
});

// The clamp takes the wrap's layout box — the size it has before any transform —
// because during an animated zoom the rendered rect still describes the previous
// frame. Each case below names the layout box and lets scale/rotation do the rest.
test('clampPan bounds pan to half the overflow (no blank edges)', () => {
  // Native 1000x800 at 2x renders 2000x1600 inside the 1000x800 stage: the offset
  // may reach (2000-1000)/2 = 500 and (1600-800)/2 = 400.
  const box = boxOf(1000, 800);
  {
    const out = clampPan({ scale: 2, zoomX: 0, zoomY: 0, rot: 0 }, stage, box);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
  // Dragged 600px right: past the 500 bound, so it is pulled back to 500.
  {
    const out = clampPan({ scale: 2, zoomX: 600, zoomY: 0, rot: 0 }, stage, box);
    assert.equal(out.zoomX, 500);
  }
  // Vertical analogue, and the negative direction.
  {
    const out = clampPan({ scale: 2, zoomX: 0, zoomY: 600, rot: 0 }, stage, box);
    assert.equal(out.zoomY, 400);
    const back = clampPan({ scale: 2, zoomX: -600, zoomY: -600, rot: 0 }, stage, box);
    assert.equal(back.zoomX, -500);
    assert.equal(back.zoomY, -400);
  }
});

test('rotatedBounds swaps the axes at a quarter turn', () => {
  const flat = rotatedBounds(1000, 800, 0);
  assert.equal(flat.width, 1000);
  assert.equal(flat.height, 800);
  // A quarter turn about the centre: the bounds swap over.
  const turned = rotatedBounds(1000, 800, 90);
  assert.ok(Math.abs(turned.width - 800) < 1e-9);
  assert.ok(Math.abs(turned.height - 1000) < 1e-9);
  // Half a turn is back to the original bounds.
  const flipped = rotatedBounds(1000, 800, 180);
  assert.ok(Math.abs(flipped.width - 1000) < 1e-9);
  assert.ok(Math.abs(flipped.height - 800) < 1e-9);
  // 45° is the widest case: both axes contribute.
  const diagonal = rotatedBounds(1000, 800, 45);
  assert.ok(Math.abs(diagonal.width - 900 * Math.SQRT2) < 1e-6);
});

test("a double-tap's anchor survives the clamp (the zoom grows from the finger)", () => {
  // This is what the rendered-rect clamp broke. Tapping a quarter in from the
  // left edge asks to zoom to 2x anchored there; the clamp then measured the
  // still-un-zoomed box (700x520, inside the 1000x800 stage), collapsed every
  // bound to 0, and threw the anchor away — so the photo zoomed from its centre.
  const box = boxOf(700, 520);
  const anchored = zoomToPoint({ scale: 1, zoomX: 0, zoomY: 0, rot: 0 }, 2, 250, 400, stage);
  assert.ok(Math.abs(anchored.zoomX - 250) < 1e-6, 'the engine anchors off-centre');
  // At 2x the box is 1400x1040, so the bounds are ±200 horizontally and ±120
  // vertically: the anchor is pulled to the bound rather than zeroed. The tap was
  // level with the vertical centre, so nothing moves on that axis.
  const clamped = clampPan(anchored, stage, box);
  assert.equal(clamped.zoomX, 200);
  assert.equal(clamped.zoomY, 0);
});

test('clampPan centres media smaller than the viewport (bug: corner slam)', () => {
  // Native 600x480 at 1.3x renders 780x624 — still inside the 1000x800 stage.
  // Both edge conditions ("no gap left" and "no gap right") cannot hold at
  // once for a sub-viewport box; the only valid offset is the centre, so a
  // panned value must collapse to 0 instead of being pinned to a corner.
  const small = boxOf(600, 480);
  const out = clampPan({ scale: 1.3, zoomX: 240, zoomY: -180, rot: 0 }, stage, small);
  assert.equal(out.zoomX, 0);
  assert.equal(out.zoomY, 0);
  // One axis bigger than the stage, the other smaller: clamp per axis. Native
  // 1000x390 at 1.6x is 1600x624 — wide enough to pan by 300, too short to move.
  const mixed = boxOf(1000, 390);
  const mixedOut = clampPan({ scale: 1.6, zoomX: 999, zoomY: 999, rot: 0 }, stage, mixed);
  assert.equal(mixedOut.zoomX, 300);
  assert.equal(mixedOut.zoomY, 0);
});

test('clampPan resets to centre when scale is at/below 1', () => {
  const small = boxOf(600, 480);
  const out = clampPan({ scale: 1, zoomX: 40, zoomY: -20, rot: 0 }, stage, small);
  assert.equal(out.zoomX, 0);
  assert.equal(out.zoomY, 0);
});

test('clampPan recentres media shrunk below fit scale', () => {
  // MIN_SCALE is 0.5, so a pinch-out can leave the media smaller than the
  // stage: it must return to the centre rather than stay where the gesture
  // left it. `scale` 0.8 is at rest, so the offset collapses on both axes.
  const shrunk = boxOf(500, 400);
  const out = clampPan({ scale: 0.8, zoomX: 150, zoomY: -90, rot: 0 }, stage, shrunk);
  assert.equal(out.zoomX, 0);
  assert.equal(out.zoomY, 0);
});

test('clampPan keeps a rotated image pannable at fit scale (rotate-then-drag)', () => {
  // A portrait image (1000x1500) rotated 90° occupies a 1500x1000 box, which
  // overflows the 1000x800 stage on the height axis by 200, so a vertical offset
  // up to ±100 must be allowed. At fit scale this used to be force-centred on
  // every frame, freezing the drag after a pure rotation.
  const rotated = boxOf(1000, 1500);
  // 60px vertical offset is within the ±100 bound → kept (not zeroed).
  {
    const out = clampPan({ scale: 1, zoomX: 0, zoomY: 60, rot: 90 }, stage, rotated);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 60);
  }
  // An offset past the bound is pulled back to the bound.
  {
    const out = clampPan({ scale: 1, zoomX: 0, zoomY: 300, rot: 90 }, stage, rotated);
    assert.ok(Math.abs(out.zoomY - 100) < 1e-6);
  }
  // Rest + unrotated still centres (original behaviour unchanged).
  {
    const small = boxOf(600, 480);
    const out = clampPan({ scale: 1, zoomX: 40, zoomY: -20, rot: 0 }, stage, small);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
});

test('isZoomedBeyondViewport gates panning on real overflow (defect 3)', () => {
  // Native 600x480 scaled 1.3x → 780x624, still well inside the 1000x800 stage.
  const smallZoomed = at(110, 88, 780, 624);
  assert.equal(isZoomedBeyondViewport(stage, smallZoomed), false);
  // A 1000x800 image at 1.3x overflows on both axes.
  const bigZoomed = at(-150, -120, 1300, 1040);
  assert.equal(isZoomedBeyondViewport(stage, bigZoomed), true);
});

test('zoomToPoint anchors on the cursor and stays centred at scale 1', () => {
  // Zoom to 2x around a point 200px right of centre.
  const out = zoomToPoint({ scale: 1, zoomX: 0, zoomY: 0, rot: 0 }, 2, 700, 400, stage);
  // Anchor x=700, Sx=500: zoomX = 700-500 - (2*(700-500-0))/1 = 200 - 400 = -200.
  assert.equal(out.scale, 2);
  assert.ok(Math.abs(out.zoomX - -200) < 1e-6);
  // Dropping back to 1 clears the pan.
  const reset = zoomToPoint(out, 1, 700, 400, stage);
  assert.equal(reset.scale, 1);
  assert.equal(reset.zoomX, 0);
  assert.equal(reset.zoomY, 0);
});

test('pinchTransform follows the two-finger midpoint (defect 1)', () => {
  const start = { dist: 100, angle: 0, s: 1, x: 0, y: 0, r: 0 };
  // Symmetric pinch about the centre → no pan, scale = ratio.
  {
    const out = pinchTransform(start, { x: 300, y: 400 }, { x: 700, y: 400 }, stage);
    assert.equal(out.scale, 4);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
    assert.equal(out.rot, 0);
  }
  // Off-centre fingers: the image must shift to keep the midpoint anchored.
  {
    const out = pinchTransform(start, { x: 200, y: 400 }, { x: 600, y: 400 }, stage);
    assert.equal(out.scale, 4);
    // midpoint x=400, Sx=500: zoomX = 400-500 - (4*(400-500-0))/1 = -100 + 400 = 300.
    assert.ok(Math.abs(out.zoomX - 300) < 1e-6);
  }
  // Rotating the fingers 90° rotates the image 90°.
  {
    const out = pinchTransform(start, { x: 500, y: 200 }, { x: 500, y: 600 }, stage);
    assert.equal(out.scale, 4);
    assert.equal(out.rot, 90);
  }
  // When already rotated, the anchor pins to centre (no finger-follow).
  {
    const rotStart = { ...start, r: 90 };
    const out = pinchTransform(rotStart, { x: 200, y: 400 }, { x: 600, y: 400 }, stage);
    assert.equal(out.rot, 90);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
});

test('ctrlZoomTransform scales and rotates about a fixed centre (Ctrl+drag)', () => {
  // Fixed centre is the card centre; the pointer's distance drives scale and its
  // angle around the centre drives rotation. The pivot stays centred (zoomX/zoomY = 0).
  const center = { x: 300, y: 300 };
  const start = { scale0: 1, dist0: 100, angle0: 0, r: 0 };
  // Pointer on the centre: distance floored at 12 → ratio 0.12 → MIN_SCALE, no rotation.
  {
    const out = ctrlZoomTransform(start, { x: 300, y: 300 }, center);
    assert.equal(out.scale, MIN_SCALE);
    assert.equal(out.rot, 0);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
  // Pointer 200px right of centre: distance doubles → scale 2, angle 0 → no rotation.
  {
    const out = ctrlZoomTransform(start, { x: 500, y: 300 }, center);
    assert.equal(out.scale, 2);
    assert.equal(out.rot, 0);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
  // Pointer straight below centre: distance 200 → scale 2, angle 90° → rotated 90°.
  {
    const out = ctrlZoomTransform(start, { x: 300, y: 500 }, center);
    assert.equal(out.scale, 2);
    assert.equal(out.rot, 90);
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
  // Continuing the rotation from an already-rotated start: +90 on top of 90 → 180.
  {
    const out = ctrlZoomTransform(
      { scale0: 1, dist0: 100, angle0: 0, r: 90 },
      { x: 300, y: 500 },
      center,
    );
    assert.equal(out.rot, 180);
  }
});

test('classifyTap detects a quick nearby second tap as double (defect 5)', () => {
  assert.equal(classifyTap(null, 1000, 100, 100), 'single');
  assert.equal(classifyTap({ t: 900, x: 100, y: 100 }, 1000, 100, 100), 'double');
  assert.equal(classifyTap({ t: 500, x: 100, y: 100 }, 1000, 100, 100), 'single');
  assert.equal(classifyTap({ t: 900, x: 100, y: 100 }, 1000, 300, 300), 'single');
});

test('classifySwipe maps displacement to a direction past threshold (feature gestures)', () => {
  assert.equal(classifySwipe(100, 0, 60), 'right');
  assert.equal(classifySwipe(-100, 0, 60), 'left');
  assert.equal(classifySwipe(0, 100, 60), 'down');
  assert.equal(classifySwipe(0, -100, 60), 'up');
  assert.equal(classifySwipe(30, 0, 60), null);
  assert.equal(classifySwipe(80, 20, 60), 'right');
});

test('classifyRelease never turns the tail of a pinch into a swipe', () => {
  const base = { pinchSequence: false, panning: false, dx: 0, dy: 0, triggerAt: 60, isTouch: true };
  // Closing a two-finger zoom releases the partner finger at a point up to a whole
  // pinch-width away from the press point captured during the pinch. That distance
  // is what used to be classified as a swipe: zooming voted on the photo and
  // advanced, which also reset the rotation and made the rotate look lost.
  assert.deepEqual(classifyRelease({ ...base, pinchSequence: true, dx: 120, dy: -40 }), {
    kind: 'pinch-tail',
  });
  // The very same displacement without a pinch behind it is an ordinary swipe.
  assert.deepEqual(classifyRelease({ ...base, dx: 120, dy: -40 }), {
    kind: 'swipe',
    dir: 'right',
  });
  // A tail on an already-zoomed photo may still finish its pan.
  assert.deepEqual(classifyRelease({ ...base, pinchSequence: true, panning: true }), {
    kind: 'pan-end',
  });
  // A finger that barely moved is a tap on touch; the mouse path keeps dblclick.
  assert.deepEqual(classifyRelease({ ...base, dx: 3, dy: 4 }), { kind: 'tap' });
  assert.deepEqual(classifyRelease({ ...base, dx: 3, dy: 4, isTouch: false }), { kind: 'none' });
});

test('a tap still lands once the photo is zoomed (double tap toggles back out)', () => {
  // Once zoomed, every single-finger touch is a pan to `onPointerMove`, so
  // `panning` is true even for a tap. Judging the pan first made the release
  // unreachable as a tap: the double tap that zooms in worked (it starts
  // un-panned) and the one that zooms back out silently did nothing — you had to
  // pinch to get back to a whole photo, and pinch was the harder gesture. Mouse
  // hid the bug entirely, because the desktop double-click never enters this
  // state machine.
  const zoomedAndPanned = { pinchSequence: false, panning: true, triggerAt: 30, isTouch: true };
  assert.deepEqual(classifyRelease({ ...zoomedAndPanned, dx: 2, dy: -1 }), { kind: 'tap' });
  // A real drag over the same zoomed photo still ends as a pan, not a tap.
  assert.deepEqual(classifyRelease({ ...zoomedAndPanned, dx: 40, dy: 5 }), { kind: 'pan-end' });
  // And the same small movement on a mouse is not a tap: the desktop has dblclick.
  assert.deepEqual(classifyRelease({ ...zoomedAndPanned, dx: 2, dy: -1, isTouch: false }), {
    kind: 'pan-end',
  });
});

test('a two-finger rotate survives the release snap', () => {
  // Fingers start 100px apart horizontally about the stage centre and rotate to
  // vertical while spreading: the image must keep the quarter turn, not snap back.
  const start = { dist: 100, angle: 0, s: 1, x: 0, y: 0, r: 0 };
  const cw = pinchTransform(start, { x: 500, y: 300 }, { x: 500, y: 700 }, stage);
  assert.equal(cw.rot, 90);
  assert.equal(snapRotation(cw.rot), 90);
  // The other way round keeps its sign, so the transition does not spin the long
  // way: -90 must not become 270.
  const ccw = pinchTransform(start, { x: 500, y: 700 }, { x: 500, y: 300 }, stage);
  assert.equal(ccw.rot, -90);
  assert.equal(snapRotation(ccw.rot), -90);
  // Rotating from an already-zoomed start composes instead of restarting: the
  // 4x spread on top of 2x asks for 8x and lands on the ceiling.
  const zoomed = pinchTransform(
    { dist: 100, angle: 0, s: 2, x: 0, y: 0, r: 0 },
    { x: 500, y: 300 },
    { x: 500, y: 700 },
    stage,
  );
  assert.equal(zoomed.scale, MAX_SCALE);
  assert.equal(zoomed.rot, 90);
});

test('classifyClickNav splits the mask left=prev / right=next (feature 1)', () => {
  assert.equal(classifyClickNav(100, 1000), 'prev');
  assert.equal(classifyClickNav(900, 1000), 'next');
  assert.equal(classifyClickNav(500, 1000), 'next');
});
