/**
 * Lightbox multi-touch regressions.
 *
 * These drive the gesture with synthetic **pointer** events rather than CDP
 * `Input.dispatchTouchEvent` on purpose: a pinch is released one finger at a time,
 * and CDP's `touchEnd` semantics make it impossible to state reliably which finger
 * stays down, so the interesting case — the surviving finger dragging after its
 * partner lifts — silently never happened. Pointer events are what the component
 * listens to anyway; only `setPointerCapture` is stubbed, because it rejects ids
 * that no real pointer owns and plays no part in the gesture state machine.
 */
import { expect, test, type Page } from '@playwright/test';
import { locales } from '../../../src/shared/copy';
import type { Photo, SyncResponse } from '../../../src/shared/types';

const enCopy = locales['en-US'];

const photos: Photo[] = Array.from({ length: 2 }, (_, index) => ({
  id: index + 1,
  sha256: `photo-${index}`,
  url: `https://media.test/${index}.webp`,
  uploader: 0,
  width: 1200,
  height: 800,
  size: 1024,
  createdAt: 1_700_000_000_000 + index * 1000,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
}));

type Pt = [number, number];

async function mockAlbum(page: Page) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  });
  await page.route('**/sync', (route) =>
    route.fulfill({
      json: {
        ok: true,
        selfId: 7,
        serverTime: Date.now(),
        mediaHostUrl: 'https://facade.test',
        photos,
        announcements: [],
        polls: [],
        feedback: [],
      } satisfies SyncResponse,
    }),
  );
  await page.route('https://media.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#174450"/></svg>',
    }),
  );
  await page.route('**/vote', (route) => route.fulfill({ json: { ok: true } }));
}

// A phone-sized viewport is the point: the swipe threshold scales with page width,
// so it is 30px here and 100px on a desktop window. This bug was a mobile one and
// desktop geometry is far too forgiving to expose it.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

async function openLightbox(page: Page) {
  await mockAlbum(page);
  await page.goto('/');
  await page.locator('main img').first().click();
  const lightbox = page.getByRole('dialog', { name: enCopy.lightbox.preview });
  await expect(lightbox.locator('img.lb-media')).toBeVisible();
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  return lightbox;
}

type Lightbox = Awaited<ReturnType<typeof openLightbox>>;

async function send(page: Page, type: string, points: Array<{ id: number; x: number; y: number }>) {
  await page.evaluate(
    ({ type, points, label }) => {
      const stage = document.querySelector(`div[role="dialog"][aria-label="${label}"]`)!;
      for (const p of points) {
        stage.dispatchEvent(
          new PointerEvent(type, {
            pointerId: p.id,
            pointerType: 'touch',
            clientX: p.x,
            clientY: p.y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { type, points, label: enCopy.lightbox.preview },
  );
}

const both = (page: Page, a: Pt, b: Pt, type: string) =>
  send(page, type, [
    { id: 1, x: a[0], y: a[1] },
    { id: 2, x: b[0], y: b[1] },
  ]);
const down = (page: Page, a: Pt, b: Pt) => both(page, a, b, 'pointerdown');
const move = (page: Page, a: Pt, b: Pt) => both(page, a, b, 'pointermove');
const lift = (page: Page, id: number, p: Pt) => send(page, 'pointerup', [{ id, x: p[0], y: p[1] }]);
const drag = (page: Page, id: number, p: Pt) =>
  send(page, 'pointermove', [{ id, x: p[0], y: p[1] }]);

async function transformOf(lightbox: Lightbox): Promise<string> {
  return lightbox
    .locator('.will-change-transform')
    .evaluate((n) => (n as HTMLElement).style.transform);
}

/** Pull the numbers out of a `translate(Xpx, Ypx) scale(S) rotate(Rdeg)` string. */
function parsed(transform: string) {
  const translate = transform.match(/translate\(([^)]+)\)/)?.[1]?.split(',') ?? ['0px', '0px'];
  return {
    scale: Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1),
    tx: Number.parseFloat(translate[0] ?? '0'),
    ty: Number.parseFloat(translate[1] ?? '0'),
  };
}

/**
 * A tap as a finger makes it: a press, a few px of unavoidable travel, and a
 * release. That travel matters — once zoomed, `onPointerMove` starts a pan from
 * it, and a pan used to outrank the tap so the release never reached the
 * double-tap check.
 */
async function tapAt(page: Page, id: number, x: number, y: number, travel = 0) {
  await send(page, 'pointerdown', [{ id, x, y }]);
  if (travel > 0) await drag(page, id, [x + travel, y + travel]);
  await lift(page, id, [x + travel, y + travel]);
}

async function doubleTap(page: Page, x: number, y: number, travel = 0) {
  await tapAt(page, 1, x, y, travel);
  await page.waitForTimeout(120);
  await tapAt(page, 2, x, y, travel);
}

/** A real mobile browser fires native `click` (after each tap) and `dblclick`
 *  (after the pair) on top of the pointer events. The harness drives gestures
 *  with pointer events only, so it has to replay those too — they are exactly
 *  what used to undo the zoom the touch path had just applied. */
async function sendMouse(page: Page, type: 'click' | 'dblclick', x: number, y: number) {
  await page.evaluate(
    ({ type, x, y, label }) => {
      const stage = document.querySelector(`div[role="dialog"][aria-label="${label}"]`)!;
      stage.dispatchEvent(
        new MouseEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    },
    { type, x, y, label: enCopy.lightbox.preview },
  );
}

test('a touch double tap zooms about the tapped point, not the centre', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // Off-centre on purpose: the media is centred in the stage, so any anchoring
  // at the tap point has to show up as a real translate.
  await doubleTap(page, 100, 360);
  const zoomed = parsed(await transformOf(lightbox));
  expect(zoomed.scale).toBe(2);
  expect(Math.abs(zoomed.tx)).toBeGreaterThan(20);
  await page.waitForTimeout(600);
  // Still there once it settles, and no vote, no paging.
  expect(parsed(await transformOf(lightbox)).scale).toBe(2);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
});

test('a real mobile double tap is not undone by the trailing native dblclick', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // The harness drives gestures with pointer events only, so the native click and
  // dblclick a real browser dispatches after a touch double tap never ran before.
  // They are what undid the zoom: the trailing click swallowed and cleared the
  // suppression window, so the dblclick that followed re-toggled the zoom back to 1.
  await doubleTap(page, 100, 360);
  // Replay what Chrome-on-Android emits: a click per tap, then a dblclick.
  await sendMouse(page, 'click', 100, 360);
  await sendMouse(page, 'click', 100, 360);
  await sendMouse(page, 'dblclick', 100, 360);
  await page.waitForTimeout(50);
  expect(parsed(await transformOf(lightbox)).scale).toBe(2);
  await page.waitForTimeout(600);
  // Still zoomed, and no vote or paging from the spurious events.
  expect(parsed(await transformOf(lightbox)).scale).toBe(2);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
});

test('a second double tap zooms back out after a pinch', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // Zoom in by pinch first: the photo now overflows the stage, which is what
  // makes the next single-finger touch classify as a pan.
  await down(page, [145, 422], [245, 422]);
  await move(page, [95, 422], [295, 422]);
  await move(page, [45, 422], [345, 422]);
  await lift(page, 1, [45, 422]);
  await lift(page, 2, [345, 422]);
  await page.waitForTimeout(400);
  expect(parsed(await transformOf(lightbox)).scale).toBeGreaterThan(1);

  // Each tap carries real finger travel. Before the fix this ended as a pan —
  // the photo merely shifted a few px and stayed at 3x, so double tapping could
  // zoom in but never back out, and only a pinch got you back to the whole photo.
  await doubleTap(page, 195, 422, 3);
  await page.waitForTimeout(600);
  expect(parsed(await transformOf(lightbox)).scale).toBe(1);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
});

test('the desktop double-click keeps the same anchor', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // The mouse path is the native dblclick and never enters the release state
  // machine, so it must behave identically to touch — including the anchor.
  await page.mouse.dblclick(100, 360);
  await page.waitForTimeout(600);
  const zoomed = parsed(await transformOf(lightbox));
  expect(zoomed.scale).toBe(2);
  expect(Math.abs(zoomed.tx)).toBeGreaterThan(20);
});

test('two-finger pinch rotates the photo', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // 200px apart about the centre, rotated to vertical at a constant distance:
  // a pure quarter turn with no zoom component.
  await down(page, [95, 422], [295, 422]);
  await move(page, [125, 362], [265, 482]);
  await move(page, [195, 322], [195, 522]);
  await lift(page, 1, [195, 322]);
  await lift(page, 2, [195, 522]);
  const transform = await transformOf(lightbox);
  expect(/rotate\(90deg\)/.test(transform)).toBe(true);
  await page.waitForTimeout(600);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
});

test('a pinch tail never votes, pages or opens the menu', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // Pinch closed to 0.5: the photo is now smaller than the stage, so it neither
  // overflows the viewport nor is rotated — the state in which a leftover finger
  // used to be judged as a fresh swipe.
  await down(page, [95, 422], [295, 422]);
  await move(page, [145, 422], [245, 422]);
  // Finger 1 lifts; finger 2 keeps sliding as the hand pulls away. That is how a
  // pinch ends on a phone, and it is 110px of travel — far past the 30px
  // threshold at this width.
  await lift(page, 1, [145, 422]);
  await drag(page, 2, [265, 422]);
  await drag(page, 2, [295, 422]);
  await drag(page, 2, [325, 422]);
  await drag(page, 2, [355, 422]);
  await lift(page, 2, [355, 422]);
  expect(await transformOf(lightbox)).toContain('scale(0.5)');
  // Let the 200ms advance timer run out before asserting nothing moved.
  await page.waitForTimeout(600);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.dislike, exact: true }),
  ).toContainText('0');
  await expect(page.getByRole('dialog', { name: enCopy.lightbox.actions })).toHaveCount(0);
});

test('a pinch tail on a zoomed photo pans without voting', async ({ page }) => {
  const lightbox = await openLightbox(page);
  // Spread apart: the photo now overflows the stage, so a leftover finger drags
  // the view instead of being classified at all.
  await down(page, [145, 422], [245, 422]);
  await move(page, [95, 422], [295, 422]);
  await move(page, [45, 422], [345, 422]);
  await lift(page, 1, [45, 422]);
  await drag(page, 2, [315, 422]);
  await drag(page, 2, [285, 422]);
  await lift(page, 2, [285, 422]);
  await page.waitForTimeout(600);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.dislike, exact: true }),
  ).toContainText('0');
});
