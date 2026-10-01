import { expect, test } from '@playwright/test';
import { fmt, locales, plural } from '../../../src/shared/copy';
import type { Poll, SyncResponse } from '../../../src/shared/types';

const locale = 'zh-CN';
const copy = locales[locale];
const voteCount = (count: number): string => fmt(plural(count, copy.vote.count, locale), { count });

const previewPoll: Poll = {
  id: 42,
  title: 'Existing poll',
  options: ['Choice A', 'Choice B'],
  allowMultiple: true,
  locale,
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
        locale,
        announcements: [],
        polls: [previewPoll],
        feedback: [],
      } satisfies SyncResponse,
    });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: copy.admin.newAnnouncement }).click();

  const dialog = page.getByRole('dialog', {
    name: copy.admin.editor.titlePlaceholder,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: copy.admin.editor.save });
  await expect(save).toBeDisabled();

  const title = dialog.getByLabel(copy.admin.editor.titlePlaceholder);
  const editor = dialog.locator('textarea');
  await title.fill('Test announcement');
  await expect(save).toBeDisabled();

  await editor.fill('hello');
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 5);
  });
  await dialog.getByRole('button', { name: copy.editor.tools.bold }).click();
  await expect(editor).toHaveValue('**hello**');
  await expect(
    dialog.getByRole('button', { name: copy.admin.tabs.polls, exact: true }),
  ).toHaveCount(0);

  await editor.fill(
    '::vote:42\nBody\n![Safe image](https://example.com/image.png)\n![Unsafe image](javascript:alert(1))\n[Unsafe link](javascript:alert(1))',
  );
  const preview = dialog.getByLabel(copy.editor.previewAria);
  await expect(preview.getByRole('heading', { name: previewPoll.title })).toBeVisible();
  await expect(preview).toContainText('67%');
  await expect(preview).toContainText(voteCount(2));
  await expect(preview).not.toContainText('::vote:42');
  await expect(preview.locator('img')).toHaveCount(1);
  await expect(preview.locator('img')).toHaveAttribute('src', 'https://example.com/image.png');
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(save).toBeEnabled();

  await dialog.getByRole('button', { name: copy.admin.editor.cancel }).last().click();
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
        locale,
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
  const adminTabs = page.getByRole('tablist', { name: copy.admin.sectionLabel });
  await expect(adminTabs).toBeVisible();
  const [tabsBox, localeBox] = await Promise.all([
    adminTabs.boundingBox(),
    page.getByRole('button', { name: copy.settings.switchToEnglish }).boundingBox(),
  ]);
  expect(tabsBox).not.toBeNull();
  expect(localeBox).not.toBeNull();
  expect(localeBox!.x).toBeGreaterThan(tabsBox!.x + tabsBox!.width);
  expect(localeBox!.x).toBeLessThan((await page.evaluate(() => window.innerWidth)) / 2);
  await page.getByRole('tab', { name: copy.admin.tabs.polls, exact: true }).click();

  const existingRow = page.getByRole('listitem').filter({ hasText: previewPoll.title });
  await expect(existingRow).toContainText('67%');
  await expect(existingRow).toContainText(voteCount(2));

  await page.getByRole('button', { name: copy.admin.newPoll, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.admin.newPoll, exact: true });
  await dialog
    .getByRole('textbox', { name: copy.admin.editor.pollTitle })
    .fill('New multi-choice poll');
  const optionOne = dialog.getByRole('textbox', {
    name: fmt(copy.admin.editor.pollOptionLabel, { number: 1 }),
  });
  const optionTwo = dialog.getByRole('textbox', {
    name: fmt(copy.admin.editor.pollOptionLabel, { number: 2 }),
  });
  await expect(dialog.getByRole('textbox')).toHaveCount(3);
  await expect(
    dialog.getByRole('button', {
      name: fmt(copy.admin.editor.removePollOption, { number: 1 }),
    }),
  ).toBeDisabled();
  await optionOne.fill('Option A');
  await optionTwo.fill('Option B');
  await dialog.getByRole('button', { name: copy.admin.editor.addPollOption }).click();
  const optionThree = dialog.getByRole('textbox', {
    name: fmt(copy.admin.editor.pollOptionLabel, { number: 3 }),
  });
  await optionThree.fill('Option C');
  await dialog
    .getByRole('button', { name: fmt(copy.admin.editor.removePollOption, { number: 3 }) })
    .click();
  await expect(dialog.getByRole('textbox')).toHaveCount(3);
  await dialog.getByRole('button', { name: copy.admin.editor.pollAllowMultiple }).click();
  const createRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/admin/polls' && request.method() === 'POST',
  );
  await dialog.getByRole('button', { name: copy.admin.editor.save, exact: true }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({
    allowMultiple: true,
    locale,
    options: ['Option A', 'Option B'],
  });

  const row = page.getByRole('listitem').filter({ hasText: 'New multi-choice poll' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(copy.admin.poll.multipleAnswers);
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
  await row.getByRole('button', { name: copy.admin.poll.copySyntax }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __testClipboard?: { value: string } }).__testClipboard?.value,
      ),
    )
    .toBe(`::vote:${createdId}`);
});
