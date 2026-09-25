import { expect, test } from '@playwright/test';

test('admin announcement dialog validates, transforms, and previews safely', async ({ page }) => {
  // /admin is the static SPA shell; seed the cached selfId so the page mounts
  // as root on first frame (fresh browser would redirect to '/').
  await page.addInitScript(() => localStorage.setItem('infoto-self-id', '0'));
  await page.route('**/sync', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        serverTime: Date.now(),
        selfId: 0,
        photos: [],
        announcements: [],
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
    ':::vote 选项甲 | 选项乙\n正文\n![安全图片](https://example.com/image.png)\n![危险图片](javascript:alert(1))\n[危险链接](javascript:alert(1))',
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
