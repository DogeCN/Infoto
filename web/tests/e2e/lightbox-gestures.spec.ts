import { expect, test, type Page } from '@playwright/test';
import { locales } from '../../../src/shared/copy';
import type { Photo } from '../../../src/shared/types';
import { mountAlbum } from './albumSocket';

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

async function mockAlbum(page: Page) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await mountAlbum(page, {
    selfId: 7,
    snapshot: { photos, announcements: [], polls: [], feedback: [] },
  });
  await page.route('https://media.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#174450"/></svg>',
    }),
  );
  await page.route('**/vote', (route) => route.fulfill({ json: { ok: true } }));
}

test.use({ viewport: { width: 1280, height: 800 } });

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

async function parsed(lightbox: Lightbox) {
  const wrap = lightbox.locator('.will-change-transform');
  const transform = await wrap.evaluate((n) => (n as HTMLElement).style.transform);
  const transition = await wrap.evaluate((n) => (n as HTMLElement).style.transition);
  const translate = transform.match(/translate\(([^)]+)\)/)?.[1]?.split(',') ?? ['0px', '0px'];
  return {
    tx: Number.parseFloat(translate[0] ?? '0'),
    ty: Number.parseFloat(translate[1] ?? '0'),
    scale: Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1),
    rot: (() => {
      const match = transform.match(/rotate\(([-\d.NaN]+)deg\)/)?.[1];
      return match === undefined ? 0 : Number.parseFloat(match);
    })(),
    transition,
  };
}

test('a zoomed photo drags freely, then springs back to the centre on release', async ({
  page,
}) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // Wheel-zoom anchored off-centre so the zoom itself leaves a real translate.
  await page.mouse.move(cx - 200, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  const zoomed = await parsed(lightbox);
  expect(zoomed.scale).toBeGreaterThan(1.2);

  // Drag well past where the old half-overflow bound sat: the gesture is still
  // unbounded, so the photo follows the cursor wherever it goes.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 320, cy + 160, { steps: 10 });
  const midDrag = await parsed(lightbox);
  expect(midDrag.scale).toBeGreaterThan(1.2);
  expect(Math.abs(midDrag.tx - zoomed.tx - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs(midDrag.ty - zoomed.ty - 160)).toBeLessThanOrEqual(2);

  // Release: a plain drag — even on a zoomed photo — returns to the centre, position
  // only; the zoom it built up stays.
  await page.mouse.up();
  await page.waitForTimeout(400);
  const home = await parsed(lightbox);
  expect(home.scale).toBeGreaterThan(1.2);
  expect(Math.abs(home.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(home.ty)).toBeLessThanOrEqual(2);
});

test('a double-click zoomed photo drags, then springs back to the centre', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // Zoom 2x anchored left of centre, so the zoom itself leaves a translate that the
  // settle keeps (a discrete zoom anchors on the cursor on purpose).
  await page.mouse.dblclick(cx - 180, cy);
  await page.waitForTimeout(400);
  const zoomed = await parsed(lightbox);
  expect(zoomed.scale).toBe(2);
  expect(zoomed.tx).toBeGreaterThan(100);

  // 260px of drag: the gesture is unbounded, so the photo follows the cursor.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 140, { steps: 10 });
  const midDrag = await parsed(lightbox);
  expect(Math.abs(midDrag.tx - zoomed.tx - 260)).toBeLessThanOrEqual(2);
  expect(Math.abs(midDrag.ty - zoomed.ty - 140)).toBeLessThanOrEqual(2);

  // Release: a plain drag on a zoomed photo still returns to the centre, leaving the zoom.
  await page.mouse.up();
  await page.waitForTimeout(400);
  const home = await parsed(lightbox);
  expect(home.scale).toBe(2);
  expect(Math.abs(home.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(home.ty)).toBeLessThanOrEqual(2);
});

test('Ctrl+drag rotates where the photo sits, keeping its anchored offset', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // Zoom 2x anchored left of centre: a discrete zoom keeps its offset at rest, so the
  // photo now sits off-centre on purpose (a plain drag would spring it back, but this is
  // an anchor the user zoomed into).
  await page.mouse.dblclick(cx - 180, cy);
  await page.waitForTimeout(400);
  const anchored = await parsed(lightbox);
  expect(anchored.scale).toBe(2);
  expect(Math.abs(anchored.tx)).toBeGreaterThan(100);

  // Ctrl pressed while the photo is off-centre: the pivot is the media's own centre, so
  // the anchored offset must survive the whole rotate — the photo spins where it sits.
  await page.keyboard.down('Control');
  await page.mouse.move(cx + 40, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 220, { steps: 10 });
  // Mid-gesture the photo still sits where the anchor put it: entering Ctrl pins the
  // centre where it is, and the rotation happens about that pinned point.
  const rotating = await parsed(lightbox);
  expect(Math.abs(rotating.tx - anchored.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(rotating.ty - anchored.ty)).toBeLessThanOrEqual(2);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const rotated = await parsed(lightbox);
  expect(Math.abs(rotated.rot)).toBeGreaterThan(30);
  // With both hands off, the Ctrl flow is over and the card goes home — position only, the
  // snapped angle and the zoom stay.
  expect(Math.abs(rotated.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(rotated.ty)).toBeLessThanOrEqual(2);
});

test('a lightly zoomed photo drags instead of swiping, then springs back', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // 1.2× leaves the media smaller than the stage on both axes: the old overflow gate
  // read the drag as a swipe, and the old clamp collapsed any offset to 0.
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(400);
  const zoomed = await parsed(lightbox);
  expect(zoomed.scale).toBeCloseTo(1.2, 1);

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
  const midDrag = await parsed(lightbox);
  expect(Math.abs(midDrag.tx - zoomed.tx - 120)).toBeLessThanOrEqual(2);
  expect(Math.abs(midDrag.ty - zoomed.ty - 80)).toBeLessThanOrEqual(2);

  // Release: it springs back to the centre rather than staying panned, and no mark
  // was made by the drag (a zoomed photo drags, it does not swipe).
  await page.mouse.up();
  await page.waitForTimeout(400);
  const home = await parsed(lightbox);
  expect(Math.abs(home.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(home.ty)).toBeLessThanOrEqual(2);
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
});

// The reported failure: rotating with Ctrl and letting go of the MOUSE snapped the card back
// to the stage centre the instant the rotation passed through horizontal. Two rules produce
// that — `settlePan` centres a fit, axis-aligned media, and `isRotated` reports 180° as
// axis-aligned (true for the bounding box) — so a mid-gesture settle zeroed the pan and the
// next few degrees restored it.
//
// The card belongs to the hand that is holding it: no pointer and no Ctrl means released.
test('a Ctrl rotate keeps its position when only the mouse is released', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // Anchor a 2x zoom off-centre (a discrete zoom keeps its offset; a plain drag would not,
  // so a recentre would be visible) so the card really sits off-centre.
  await page.mouse.dblclick(cx - 180, cy);
  await page.waitForTimeout(400);
  const anchored = await parsed(lightbox);
  expect(anchored.scale).toBe(2);
  expect(Math.abs(anchored.tx)).toBeGreaterThan(100);

  // Rotate to the opposite side of the pivot drawing the pointer IN, so the scale falls back
  // to fit while the angle reaches 180°. That is the exact state that used to recentre — a
  // fit, axis-aligned media — reached in the middle of a gesture the user is still holding.
  const pivot = await lightbox.locator('.will-change-transform').evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  await page.keyboard.down('Control');
  await page.mouse.move(pivot.x + 150, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x - 70, pivot.y, { steps: 14 });
  // Release ONLY the mouse. Ctrl stays down, so the card is still held.
  await page.mouse.up();
  await page.waitForTimeout(350);

  const held = await parsed(lightbox);
  expect(Math.abs(held.rot)).toBeGreaterThan(150);
  // The card is still held by Ctrl, so the position it had must survive: no recentre, no
  // jump, whether the rotation happened to land on a multiple of 90° or not.
  expect(Math.abs(held.tx - anchored.tx)).toBeLessThanOrEqual(2);

  // The mouse was already released, so letting Ctrl go ends the hold too: now, and only now,
  // the card may return to the centre. The return runs as a Web Animations animation — an
  // ease, never a hard set.
  await page.keyboard.up('Control');
  const animating = await lightbox
    .locator('.will-change-transform')
    .evaluate((n) =>
      n.getAnimations().some((a) => a instanceof Animation && a.playState === 'running'),
    );
  expect(animating).toBe(true);
  await page.waitForTimeout(450);
  const home = await parsed(lightbox);
  expect(Math.abs(home.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(home.ty)).toBeLessThanOrEqual(2);
});

// Releasing the pointer first and Ctrl second is the other way round from the case above, and
// it must behave identically: the snap happens when the rotation is let go, and the return to
// the fit view happens when the last hold ends.
test('releasing the mouse before Ctrl still snaps and still settles', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const pivot = await lightbox.locator('.will-change-transform').evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });

  // Ctrl first, then grab the media and rotate it off-axis (~40°).
  await page.keyboard.down('Control');
  await page.mouse.move(pivot.x + 150, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 115, pivot.y - 96, { steps: 10 });
  await page.waitForTimeout(120);
  const rotating = await parsed(lightbox);
  expect(Math.abs(rotating.rot)).toBeGreaterThan(20);

  // Pointer up FIRST: the rotation must snap to the nearest 90° right there.
  await page.mouse.up();
  await page.waitForTimeout(300);
  const snapped = await parsed(lightbox);
  expect(Math.abs(snapped.rot % 90)).toBeLessThanOrEqual(0.5);

  // Ctrl up second: the hold ends and the fit view returns to the centre.
  await page.keyboard.up('Control');
  await page.waitForTimeout(450);
  const home = await parsed(lightbox);
  expect(Math.abs(home.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(home.ty)).toBeLessThanOrEqual(2);
});
