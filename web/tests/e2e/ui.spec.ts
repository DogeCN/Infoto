import { expect, test, type Page } from '@playwright/test';
import type { Announcement, Photo, SyncResponse } from '../../../src/shared/types';

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

async function mockAlbum(page: Page, items = photos, announcements: Announcement[] = []) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await page.route('**/sync', (route) =>
    route.fulfill({
      json: {
        ok: true,
        selfId: 0,
        serverTime: Date.now(),
        photos: items,
        announcements,
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
  expect((await dialog.boundingBox())!.width).toBeCloseTo(360, 2);
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

test('reaction picker escapes clipping and dismisses before its sidebar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAlbum(page, photos, [
    {
      id: 1,
      title: 'Short announcement',
      contentMd: '',
      sort: 0,
      updatedAt: Date.now(),
      reactions: [],
      votes: [],
    },
  ]);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Announcements', exact: true }).click();
    const sidebar = page.getByRole('dialog', { name: 'Announcements', exact: true });
    await sidebar.getByRole('button', { name: 'Short announcement', exact: true }).click();
    const add = sidebar.getByRole('button', { name: 'Add reaction', exact: true });
    const picker = sidebar.getByRole('dialog', { name: 'Add reaction', exact: true });
    await add.click();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button')).toHaveCount(8);
    await expect(picker.getByRole('button').first()).toBeFocused();
    const box = (await picker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(836);
    for (const button of await picker.getByRole('button').all()) {
      expect(
        await button.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return [r.top + 1, r.bottom - 1].every((y) =>
            node.contains(document.elementFromPoint(r.x + r.width / 2, y)),
          );
        }),
      ).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(sidebar).toBeVisible();
    await expect(add).toBeFocused();
    await add.click();
    await sidebar.getByPlaceholder('Write your suggestion').click();
    await expect(picker).toBeHidden();
    for (const emoji of ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🤔']) {
      await add.click();
      await picker.getByRole('button', { name: emoji, exact: true }).click();
      await expect(picker).toBeHidden();
      await expect(sidebar.getByRole('button', { name: `${emoji} 1`, exact: true })).toBeVisible();
    }
    await add.click();
    await sidebar.getByRole('button', { name: 'Short announcement', exact: true }).press('Enter');
    await expect(sidebar.locator(':popover-open')).toHaveCount(0);
    await expect(picker).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('photo actions have no visible header, all hover, and open Lens through the id36 proxy', async ({
  page,
  context,
}) => {
  await mockAlbum(page, [{ ...photos[0]!, id: 1296 }]);
  await page.goto('/');
  await page.locator('main img').first().click();
  const lightbox = page.getByRole('dialog', { name: 'Media preview' });
  await lightbox.getByRole('button', { name: 'More', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Photo actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Photo actions', { exact: true })).toHaveCount(0);
  const actions = menu.locator('button, a');
  await expect(actions).toHaveCount(7);
  expect(
    new Set(
      await actions.evaluateAll((nodes) =>
        nodes.slice(0, 3).map((node) => getComputedStyle(node).color),
      ),
    ).size,
  ).toBe(3);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const action of await actions.all()) {
      await page.mouse.move(0, 0);
      await expect
        .poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor))
        .toBe('rgba(0, 0, 0, 0)');
      await action.hover();
      await expect
        .poll(() =>
          action.evaluate((node) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = getComputedStyle(node.closest('[role="document"]')!).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            const before = ctx.getImageData(0, 0, 1, 1).data;
            ctx.fillStyle = getComputedStyle(node).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            const after = ctx.getImageData(0, 0, 1, 1).data;
            return [0, 1, 2].reduce((sum, i) => sum + Math.abs(after[i]! - before[i]!), 0);
          }),
        )
        .toBeGreaterThan(20);
    }
  }
  const lens = menu.getByRole('link', { name: 'Search image', exact: true });
  const href = (await lens.getAttribute('href'))!;
  expect(new URL(href).origin).toBe('https://lens.google.com');
  expect(new URL(href).pathname).toBe('/uploadbyurl');
  expect(new URL(href).searchParams.get('url')).toBe(`${new URL(page.url()).origin}/l/100`);
  await context.route('https://lens.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Lens navigation</h1>' }),
  );
  const popupPromise = page.waitForEvent('popup');
  await lens.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(href);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(menu).toHaveCount(0);
  await expect(lightbox).toBeVisible();
  await popup.close();
});

test('failed sync attempts stop until the next explicit trigger', async ({ page }) => {
  let status = 503;
  let requests = 0;
  await page.route('**/sync', (route) => {
    requests++;
    return route.fulfill({ status, json: { ok: false, error: 'unavailable' } });
  });
  await page.goto('/');
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  expect(requests).toBe(1);
  await page.clock.install();
  await page.clock.runFor(120_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(requests).toBe(1);
  status = 429;
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await page.clock.runFor(120_000);
  expect(requests).toBe(2);
});

test('verification failures stay stopped and manual sync can recover', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { renders: 0, failWidget: true };
    Object.assign(window, {
      verificationTest: state,
      turnstile: {
        render: (_node: HTMLElement, options: Record<string, unknown>) => {
          state.renders++;
          if (
            options.retry !== 'never' ||
            options['refresh-expired'] !== 'manual' ||
            options['refresh-timeout'] !== 'manual'
          ) {
            throw new Error('Verification must not auto-retry');
          }
          queueMicrotask(() => {
            if (state.failWidget) (options['error-callback'] as () => void)();
            else (options.callback as (token: string) => void)('test-token');
          });
          return 'test-widget';
        },
        remove: () => {},
      },
    });
  });
  let requests = 0;
  let acceptToken = false;
  await page.route('**/sync', (route) => {
    requests++;
    const body = route.request().postDataJSON();
    if (!body.turnstileToken) {
      return route.fulfill({
        status: 401,
        json: { ok: false, error: 'turnstile_required', turnstileSiteKey: 'test-key' },
      });
    }
    if (!acceptToken)
      return route.fulfill({ status: 401, json: { ok: false, error: 'turnstile_failed' } });
    return route.fulfill({
      json: {
        ok: true,
        selfId: 0,
        serverTime: Date.now(),
        photos,
        announcements: [],
        feedback: [],
      },
    });
  });
  const sync = page.getByRole('button', { name: 'Sync', exact: true });
  await page.goto('/');
  await expect.poll(() => requests).toBe(1);
  await expect(sync).toHaveAttribute('aria-busy', 'false');
  expect(requests).toBe(1);
  await page.clock.install();
  await page.clock.runFor(120_000);
  expect(requests).toBe(1);
  await page.evaluate(() => {
    const state = (
      window as unknown as { verificationTest: { renders: number; failWidget: boolean } }
    ).verificationTest;
    if (state.renders !== 1) throw new Error('Unexpected widget retry');
    state.failWidget = false;
  });
  await sync.click();
  await expect.poll(() => requests).toBe(3);
  await expect(sync).toHaveAttribute('aria-busy', 'false');
  await page.clock.runFor(120_000);
  expect(requests).toBe(3);
  acceptToken = true;
  await sync.click();
  await expect(page.locator('main img').first()).toBeVisible();
  await expect(sync).toHaveAttribute('aria-busy', 'false');
  expect(requests).toBe(5);
  await page.clock.runFor(120_000);
  expect(requests).toBe(5);
});
