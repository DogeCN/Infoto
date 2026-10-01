import { expect, test } from '@playwright/test';
import type { Poll, SyncResponse } from '../../../src/shared/types';

const previewPoll: Poll = {
  id: 42,
  title: '现有投票',
  options: ['选项甲', '选项乙'],
  allowMultiple: true,
  locale: 'zh-CN',
  sort: 0,
  votes: [
    { userId: 4, option: 0 },
    { userId: 5, option: 0 },
    { userId: 6, option: 1 },
  ],
};

test('admin announcement dialog validates, transforms, and previews safely', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('infoto-self-id', '0');
    localStorage.setItem('infoto-locale', 'zh-CN');
  });
  await page.route('**/sync', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        serverTime: Date.now(),
        selfId: 0,
        mediaHostUrl: 'https://facade.test',
        photos: [],
        locale: 'zh-CN',
        announcements: [],
        polls: [previewPoll],
        feedback: [],
      } satisfies SyncResponse,
    });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增公告' }).click();

  const dialog = page.getByRole('dialog', { name: '标题', exact: true });
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
  await expect(dialog.getByRole('button', { name: '投票', exact: true })).toHaveCount(0);

  await editor.fill(
    '::vote:42\n正文\n![安全图片](https://example.com/image.png)\n![危险图片](javascript:alert(1))\n[危险链接](javascript:alert(1))',
  );
  const preview = dialog.getByLabel('实时预览');
  await expect(preview.getByRole('heading', { name: '现有投票' })).toBeVisible();
  await expect(preview).toContainText('67%');
  await expect(preview).toContainText('2 票');
  await expect(preview).not.toContainText('::vote:42');
  await expect(preview.locator('img')).toHaveCount(1);
  await expect(preview.locator('img')).toHaveAttribute('src', 'https://example.com/image.png');
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(save).toBeEnabled();

  await dialog.getByRole('button', { name: '取消' }).last().click();
  await expect(dialog).toBeHidden();
});

test('admin manages independent multiple-choice polls and copies stable references', async ({
  page,
}) => {
  const createdId = 91;
  await page.addInitScript(() => {
    localStorage.setItem('infoto-self-id', '0');
    localStorage.setItem('infoto-locale', 'zh-CN');
  });
  await page.route('**/sync', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        serverTime: Date.now(),
        selfId: 0,
        mediaHostUrl: 'https://facade.test',
        photos: [],
        locale: 'zh-CN',
        announcements: [],
        polls: [previewPoll],
        feedback: [],
      } satisfies SyncResponse,
    });
  });
  await page.route('**/admin/polls', async (route) => {
    const body = route.request().postDataJSON() as {
      title: string;
      options: string[];
      allowMultiple: boolean;
      locale: Poll['locale'];
    };
    const poll: Poll = {
      id: createdId,
      title: body.title,
      options: body.options,
      allowMultiple: body.allowMultiple,
      locale: body.locale,
      sort: 1,
      votes: [],
    };
    await route.fulfill({ json: { ok: true, poll } });
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: '投票', exact: true }).click();

  const existingRow = page.getByRole('listitem').filter({ hasText: previewPoll.title });
  await expect(existingRow).toContainText('67%');
  await expect(existingRow).toContainText('2 票');

  await page.getByRole('button', { name: '新增投票', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增投票', exact: true });
  await dialog.getByRole('textbox', { name: '投票问题' }).fill('新建多选投票');
  await dialog.getByRole('textbox', { name: '选项' }).fill('甲\n乙');
  await dialog.getByLabel('允许多选').check();
  const createRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/admin/polls' && request.method() === 'POST',
  );
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({ allowMultiple: true, locale: 'zh-CN' });

  const row = page.getByRole('listitem').filter({ hasText: '新建多选投票' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('多选');
  await page.evaluate(() => {
    const target = window as unknown as { __testClipboard?: { value: string } };
    target.__testClipboard = { value: '' };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (target.__testClipboard) target.__testClipboard.value = text;
        },
      },
    });
  });
  await row.getByRole('button', { name: '复制 Markdown 代码' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __testClipboard?: { value: string } }).__testClipboard?.value,
      ),
    )
    .toBe(`::vote:${createdId}`);
});
