import { expect, test, type Page } from '@playwright/test';
import type { Photo, SyncResponse } from '../../../src/shared/types';

const photos: Photo[] = Array.from({ length: 9 }, (_, index) => ({
  id: index + 1,
  sha256: `photo-${index}`,
  url: `https://media.test/${index}.webp`,
  uploader: 0,
  width: index % 3 === 0 ? 800 : 1200,
  height: index % 3 === 0 ? 1100 : 800,
  size: (index + 1) * 1024,
  createdAt: 1_700_000_000_000 + index * 1000,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
}));

async function mockAlbum(page: Page, items = photos) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await page.route('**/sync', (route) =>
    route.fulfill({
      json: {
        ok: true,
        selfId: 0,
        serverTime: Date.now(),
        photos: items,
        announcements: [],
        feedback: [],
      } satisfies SyncResponse,
    }),
  );
  await page.route('https://media.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#174450"/><circle cx="750" cy="200" r="100" fill="#8db5ad"/></svg>',
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockAlbum(page);
});

test('sidebar traps focus, restores its trigger, and hides inactive controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('infoto-sidebar-width-left', 'invalid'));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  expect((await dialog.boundingBox())!.width).toBe(360);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.locator('[inert][aria-hidden="true"]').count()).toBeGreaterThanOrEqual(2);
});

test('sort tabs support keyboard selection and locale changes', async ({ page }) => {
  await page.goto('/');
  const latest = page.getByRole('tab', { name: 'Latest', exact: true });
  await latest.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Hottest', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: '最热', exact: true })).toBeVisible();
});

test('nested media menu handles Escape without closing the lightbox', async ({ page }) => {
  await page.goto('/');
  await page.locator('main img').first().click();
  const lightbox = page.getByRole('dialog', { name: 'Media preview' });
  await expect(lightbox).toBeVisible();
  await lightbox.getByRole('button', { name: 'More', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Photo actions' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(lightbox).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await lightbox.getByRole('button', { name: 'More', exact: true }).click();
  await menu.getByRole('button', { name: 'Copy original', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('gallery and sidebars fit narrow viewports', async ({ page }) => {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('main img').first()).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.keyboard.press('Escape');
  }
});

test('an empty album exposes a localized empty state without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAlbum(page, []);
  await page.goto('/');
  await expect(page.getByText('No photos yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Upload your first photo', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('failed image uploads retain retry and dismissal controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('main img').first()).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'empty.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(0),
  });
  const retry = page.getByRole('button', { name: 'Retry upload', exact: true });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(retry).toHaveCount(0);
  expect(errors).toEqual([]);
});
