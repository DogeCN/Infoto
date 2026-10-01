import { expect, test } from '@playwright/test';

test('admin top bar matches the gallery density and pager behavior', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('infoto-self-id', '0');
    localStorage.setItem('infoto-locale', 'en-US');
  });
  await page.route('**/sync', (route) =>
    route.fulfill({
      json: {
        ok: true,
        serverTime: Date.now(),
        selfId: 0,
        photos: [],
        announcements: [],
        polls: [],
        feedback: [],
      },
    }),
  );

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/admin');
  const bar = page.locator('[data-admin-topbar]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-bar-mode', 'paged');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(bar).toHaveAttribute('data-bar-screen', '1');

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(bar).toHaveAttribute('data-bar-mode', 'full');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});

test('admin announcement dialog validates, transforms, and previews safely', async ({ page }) => {
  // /admin is the static SPA shell; seed the cached selfId so the page mounts
  // as root on first frame (fresh browser would redirect to '/').
  await page.addInitScript(() => {
    localStorage.setItem('infoto-self-id', '0');
    localStorage.setItem('infoto-locale', 'zh-CN');
  });
  await page.route('**/sync', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        serverTime: Date.now(),
        selfId: 0,
        photos: [],
        announcements: [],
        polls: [
          {
            id: 0,
            locale: 'zh-CN',
            title: '满意度',
            options: ['选项甲', '选项乙'],
            allowMultiple: false,
            sort: 0,
            createdAt: 0,
            updatedAt: 0,
            votes: [],
          },
        ],
        feedback: [],
      }),
    });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增公告' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: '保存' });
  await expect(save).toBeDisabled();

  const title = dialog.getByLabel('标题');
  const editor = dialog.locator('textarea');
  await title.fill('测试公告');
  await expect(save).toBeDisabled();

  await editor.fill('hello');
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 5);
  });
  await dialog.getByRole('button', { name: '粗体' }).click();
  await expect(editor).toHaveValue('**hello**');

  await editor.fill(
    '::vote:0\n正文\n![安全图片](https://example.com/image.png)\n![危险图片](javascript:alert(1))\n[危险链接](javascript:alert(1))',
  );
  const preview = dialog.getByLabel('实时预览');
  await expect(preview.getByRole('button', { name: /选项甲/ })).toBeVisible();
  await expect(preview).not.toContainText(':::vote');
  await expect(preview.locator('img')).toHaveCount(1);
  await expect(preview.locator('img')).toHaveAttribute('src', 'https://example.com/image.png');
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(save).toBeEnabled();

  await dialog.getByRole('button', { name: '取消' }).last().click();
  await expect(dialog).toBeHidden();
});
