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

async function mockAlbum(page: Page) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
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

test('a zoomed photo drags freely, without an edge clamp', async ({ page }) => {
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
  // The wheel step is eased like the double-click path.
  expect(zoomed.transition).toContain('transform');

  // Drag well past where the old half-overflow bound sat.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 320, cy + 160, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await parsed(lightbox);
  expect(dragged.scale).toBeGreaterThan(1.2);
  expect(Math.abs(dragged.tx - zoomed.tx - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs(dragged.ty - zoomed.ty - 160)).toBeLessThanOrEqual(2);
});

test('a double-click zoomed photo drags past the old edge bound', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  // Zoom 2x anchored left of centre, so the zoom itself leaves a translate.
  await page.mouse.dblclick(cx - 180, cy);
  await page.waitForTimeout(400);
  const zoomed = await parsed(lightbox);
  expect(zoomed.scale).toBe(2);
  expect(zoomed.tx).toBeGreaterThan(100);

  // 260px of drag past that: the old half-overflow bound stopped it at ~164 more.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 140, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await parsed(lightbox);
  expect(Math.abs(dragged.tx - zoomed.tx - 260)).toBeLessThanOrEqual(2);
  expect(Math.abs(dragged.ty - zoomed.ty - 140)).toBeLessThanOrEqual(2);
});

test('Ctrl+drag rotates where the photo sits instead of recentring it', async ({ page }) => {
  const lightbox = await openLightbox(page);
  const media = await lightbox.locator('img.lb-media').boundingBox();
  const cx = media!.x + media!.width / 2;
  const cy = media!.y + media!.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 180, cy + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const panned = await parsed(lightbox);
  expect(Math.abs(panned.tx)).toBeGreaterThan(100);

  // Ctrl pressed after the image has been panned: the pivot is the media's own
  // centre, so the pan must survive the whole gesture.
  await page.keyboard.down('Control');
  await page.mouse.move(cx + 40, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 220, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const rotated = await parsed(lightbox);
  expect(Math.abs(rotated.rot)).toBeGreaterThan(30);
  expect(Math.abs(rotated.tx - panned.tx)).toBeLessThanOrEqual(2);
  expect(Math.abs(rotated.ty - panned.ty)).toBeLessThanOrEqual(2);
});

test('a lightly zoomed photo pans instead of swiping, with no clamp', async ({ page }) => {
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
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await parsed(lightbox);
  expect(Math.abs(dragged.tx - zoomed.tx - 120)).toBeLessThanOrEqual(2);
  expect(Math.abs(dragged.ty - zoomed.ty - 80)).toBeLessThanOrEqual(2);
  // Still the same photo, and no mark was made by the drag.
  await expect(lightbox.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(
    lightbox.getByRole('button', { name: enCopy.lightbox.like, exact: true }),
  ).toContainText('0');
});
