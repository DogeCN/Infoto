import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  isRotated,
  isPannable,
  settlePan,
  normAngle,
  snapRotation,
  isAtRest,
  zoomToPoint,
  pinchTransform,
  ctrlZoomTransform,
  classifyTap,
  classifySwipe,
  classifyRelease,
  classifyClickNav,
  type Rect,
} from '../../src/base/lib/lightboxEngine.ts';

const stage: Rect = { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };

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

// Panning has no positional bound: `settlePan` only recentres the fit view. Every other
// state keeps the offset the gesture produced, which is what makes a drag feel free after
// a zoom, a rotation, or a double-click.
test('settlePan centres the fit view and leaves every other offset alone', () => {
  // At (or below) fit scale and unrotated: the whole-photo state is centred.
  for (const scale of [1, 0.8]) {
    const out = settlePan({ scale, zoomX: 150, zoomY: -90, rot: 0 });
    assert.equal(out.zoomX, 0);
    assert.equal(out.zoomY, 0);
  }
  // Zoomed: any offset survives, however far — a clamp used to stop the drag here.
  const zoomed = settlePan({ scale: 2, zoomX: 600, zoomY: -420, rot: 0 });
  assert.equal(zoomed.zoomX, 600);
  assert.equal(zoomed.zoomY, -420);
  // Just past fit counts as zoomed, even if the media is still smaller than the stage.
  const justZoomed = settlePan({ scale: 1.02, zoomX: 240, zoomY: -180, rot: 0 });
  assert.equal(justZoomed.zoomX, 240);
  assert.equal(justZoomed.zoomY, -180);
  // A rotated image stays where it was dragged even at fit scale: only the rotation
  // makes its bounding box overflow, so the old overflow clamp allowed a few px at most.
  const rotated = settlePan({ scale: 1, zoomX: 300, zoomY: -220, rot: 90 });
  assert.equal(rotated.zoomX, 300);
  assert.equal(rotated.zoomY, -220);
});

test('isPannable opens the drag whenever the media is zoomed or rotated', () => {
  assert.equal(isPannable(1, 0), false);
  assert.equal(isPannable(0.8, 0), false);
  assert.equal(isPannable(1.02, 0), true);
  assert.equal(isPannable(2, 180), true);
  assert.equal(isPannable(1, 90), true);
  assert.equal(isPannable(1, 180), false);
});

test("a double-tap's anchor survives (nothing clamps it back to the centre)", () => {
  // Tapping a quarter in from the left edge asks to zoom to 2x anchored there. The
  // provisional state must be the anchored one and must survive settling untouched.
  const anchored = zoomToPoint({ scale: 1, zoomX: 0, zoomY: 0, rot: 0 }, 2, 250, 400, stage);
  assert.ok(Math.abs(anchored.zoomX - 250) < 1e-6, 'the engine anchors off-centre');
  const settled = settlePan(anchored);
  assert.equal(settled.zoomX, 250);
  assert.equal(settled.zoomY, 0);
});

test('zoomToPoint anchors on the cursor and stays centred at scale 1', () => {
  // Zoom to 2x around a point 200px right of centre.
  const out = zoomToPoint({ scale: 1, zoomX: 0, zoomY: 0, rot: 0 }, 2, 700, 400, stage);
  // Anchor x=700, Sx=500: zoomX = 700-500 - (2*(700-500-0))/1 = 200 - 400 = -200.
  assert.equal(out.scale, 2);
  assert.ok(Math.abs(out.zoomX - -200) < 1e-6);
  // Dropping back to 1 clears the pan (an unrotated fit view is centred).
  const reset = zoomToPoint(out, 1, 700, 400, stage);
  assert.equal(reset.scale, 1);
  assert.equal(reset.zoomX, 0);
  assert.equal(reset.zoomY, 0);
  // A rotated fit view is pannable, so zooming it must not throw the offset away:
  // the pan scales with the zoom (0.8x of 120, -80) instead of collapsing to 0.
  const rotated = zoomToPoint({ scale: 1, zoomX: 120, zoomY: -80, rot: 90 }, 0.8, 500, 400, stage);
  assert.equal(rotated.scale, 0.8);
  assert.ok(Math.abs(rotated.zoomX - 96) < 1e-6);
  assert.ok(Math.abs(rotated.zoomY - -64) < 1e-6);
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

test('ctrlZoomTransform pivots on the media centre and keeps the pan (Ctrl+drag)', () => {
  // The pivot is the media's own centre, wherever it currently sits; the pointer's
  // distance drives scale and its angle around it drives rotation. The pan captured at
  // the start is carried through, so Ctrl never recentres a panned image.
  const center = { x: 300, y: 300 };
  const start = { scale0: 1, dist0: 100, angle0: 0, r: 0, x: 140, y: -60 };
  // Pointer on the centre: distance floored at 12 → ratio 0.12 → MIN_SCALE, no rotation.
  {
    const out = ctrlZoomTransform(start, { x: 300, y: 300 }, center);
    assert.equal(out.scale, MIN_SCALE);
    assert.equal(out.rot, 0);
    assert.equal(out.zoomX, 140);
    assert.equal(out.zoomY, -60);
  }
  // Pointer 200px right of centre: distance doubles → scale 2, angle 0 → no rotation.
  {
    const out = ctrlZoomTransform(start, { x: 500, y: 300 }, center);
    assert.equal(out.scale, 2);
    assert.equal(out.rot, 0);
    assert.equal(out.zoomX, 140);
    assert.equal(out.zoomY, -60);
  }
  // Pointer straight below centre: distance 200 → scale 2, angle 90° → rotated 90°.
  {
    const out = ctrlZoomTransform(start, { x: 300, y: 500 }, center);
    assert.equal(out.scale, 2);
    assert.equal(out.rot, 90);
    assert.equal(out.zoomX, 140);
    assert.equal(out.zoomY, -60);
  }
  // Continuing the rotation from an already-rotated start: +90 on top of 90 → 180.
  {
    const out = ctrlZoomTransform(
      { scale0: 1, dist0: 100, angle0: 0, r: 90, x: 0, y: 0 },
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
