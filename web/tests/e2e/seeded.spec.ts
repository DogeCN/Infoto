import { expect, test, type Page } from '@playwright/test';
import type { SyncResponse } from '../../../src/shared/types';

test.skip(
  !process.env['INFOTO_SEEDED_TEST'],
  'Requires seeded local D1 with the all-zero root UUID.',
);

async function enter(page: Page, role = 'root') {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  if (role === 'root') {
    const response = await page.request.post('/sync', {
      headers: { Cookie: 'uuid=00000000-0000-0000-0000-000000000000' },
      data: { ops: [] },
    });
    expect(response.ok()).toBe(true);
    expect((await response.json()).selfId).toBe(0);
  } else {
    const response = await page.request.post('/sync', {
      data: { ops: [], turnstileToken: 'seeded-e2e' },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/');
  await expect(page.locator('main img').first()).toBeVisible();
}
async function snapshot(page: Page): Promise<SyncResponse> {
  const response = await page.request.post('/sync', { data: { ops: [] } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function sync(page: Page) {
  const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/sync' && r.ok());
  await page.getByRole('button', { name: /^Sync/ }).click();
  await done;
}

test('seeded gallery supports filters, video playback, nested buttons and downloads', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  expect((await snapshot(page)).photos).toHaveLength(22);
  const video = page.locator('main video').first();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  const mute = page
    .locator('main button')
    .filter({ has: page.locator('svg.lucide-volume-x') })
    .first();
  await mute.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(video).toHaveJSProperty('muted', false);
  await page.keyboard.press('Enter');
  await expect(video).toHaveJSProperty('muted', true);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const mine = page.getByRole('button', { name: 'Uploaded by me', exact: true });
  await mine.click();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('main [role=button]').count()).toBeLessThan(22);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('main img').first().click();
  const lightbox = page.getByRole('dialog', { name: 'Media preview' });
  await expect(lightbox.locator('img')).toBeVisible();
  await lightbox.getByRole('button', { name: 'More', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Photo actions' })
    .getByRole('button', { name: 'Download', exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.webp$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('main img').first().click();
  await page.locator('main img').nth(1).click();
  const zip = page.waitForEvent('download');
  await page.getByTitle('Download', { exact: true }).click();
  expect((await zip).suggestedFilename()).toBe('download.zip');
  expect(errors).toEqual([]);
});

test('poll votes, reactions and feedback persist through real sync and reload', async ({
  page,
}) => {
  await enter(page);
  const before = await snapshot(page);
  const poll = before.polls.find((item) => item.locale === 'en-US');
  expect(poll, 'seeded database should contain an English poll').toBeTruthy();
  const announcement = before.announcements.find(
    (item) => item.locale === 'en-US' && item.contentMd.includes(`::vote:${poll!.id}`),
  );
  expect(announcement, 'an English announcement should reference the seeded poll').toBeTruthy();
  const originalOptions = poll!.votes
    .filter((vote) => vote.userId === before.selfId)
    .map((vote) => vote.option);
  const originalReaction =
    announcement!.reactions.find((reaction) => reaction.userId === before.selfId)?.emoji ?? '';
  const desiredOptions = poll!.allowMultiple
    ? originalOptions.includes(1)
      ? originalOptions.filter((option) => option !== 1)
      : [...originalOptions, 1].sort((a, b) => a - b)
    : [1];
  const text = `Local review feedback ${Date.now()}`;
  try {
    await page.getByRole('button', { name: 'Announcements', exact: true }).click();
    const sidebar = page.getByRole('dialog', { name: 'Announcements' });
    await expect(sidebar.getByRole('button', { name: 'Add reaction', exact: true })).toHaveCount(0);
    await sidebar.getByRole('button', { name: announcement!.title, exact: true }).click();
    await sidebar.getByRole('button').filter({ hasText: poll!.options[1]! }).last().click();
    await sidebar.getByRole('button', { name: 'Add reaction', exact: true }).click();
    await sidebar.getByRole('button', { name: '🔥', exact: true }).click();
    await sidebar.getByPlaceholder('Write your suggestion').fill(text);
    await sidebar.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(sidebar.getByText(text, { exact: true })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Send', exact: true }).click();
    await page.keyboard.press('Escape');
    await sync(page);
    await page.reload();
    await expect(page.locator('main img').first()).toBeVisible();
    const after = await snapshot(page);
    const savedPoll = after.polls.find((item) => item.id === poll!.id)!;
    const savedOptions = savedPoll.votes
      .filter((vote) => vote.userId === before.selfId)
      .map((vote) => vote.option)
      .sort((a, b) => a - b);
    expect(savedOptions).toEqual(desiredOptions);
    const savedAnnouncement = after.announcements.find((item) => item.id === announcement!.id)!;
    expect(
      savedAnnouncement.reactions.find((reaction) => reaction.userId === before.selfId)?.emoji,
    ).toBe('🔥');
    expect(after.feedback.some((feedback) => feedback.contentMd === text)).toBe(true);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Feedback', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill(text);
    const row = page.getByRole('listitem').filter({ hasText: text });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete feedback' }).click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () =>
        (await snapshot(page)).feedback.some((feedback) => feedback.contentMd === text),
      )
      .toBe(false);
  } finally {
    await page.request.post('/sync', {
      data: {
        ops: [
          { type: 'vote', target: poll!.id, payload: { options: originalOptions } },
          { type: 'react', target: announcement!.id, payload: { emoji: originalReaction } },
        ],
      },
    });
    for (const feedback of (await snapshot(page)).feedback.filter(
      (item) => item.contentMd === text,
    ))
      await page.request.delete(`/admin/feedback/${feedback.id}`);
  }
});

test('admin creates, edits, cancels, reorders, exports and deletes announcements', async ({
  page,
}) => {
  await enter(page);
  const before = await snapshot(page);
  const title = `Local review announcement ${Date.now()}`;
  try {
    await page.goto('/admin');
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button', { name: 'New announcement' }).click();
    const editor = page.getByRole('dialog', { name: 'Title', exact: true });
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await editor.locator('textarea').fill('## Review\n\nA **real database** draft.');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    let row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect
      .poll(async () => (await snapshot(page)).announcements.some((a) => a.title === title))
      .toBe(true);
    await row.getByRole('button', { name: 'Edit announcement' }).click();
    await editor.locator('textarea').fill('Updated review content.');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(
        async () => (await snapshot(page)).announcements.find((a) => a.title === title)?.contentMd,
      )
      .toBe('Updated review content.');
    await row.getByRole('button', { name: 'Edit announcement' }).click();
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved title');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await row.getByRole('button', { name: 'Edit announcement' }).click();
    await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    const ids = (await snapshot(page)).announcements.map((a) => a.id);
    const boxes = await page.getByRole('listitem').evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    await page.mouse.move(boxes[0]!.x + 12, boxes[0]!.y + 12);
    await page.mouse.down();
    await page.mouse.move(boxes[1]!.x + 12, boxes[1]!.y + boxes[1]!.height - 12, { steps: 15 });
    await page.mouse.up();
    await expect
      .poll(async () => (await snapshot(page)).announcements.map((a) => a.id))
      .not.toEqual(ids);
    const exported = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SQL', exact: true }).click();
    expect((await exported).suggestedFilename()).toMatch(/^infoto-export-.*\.sql$/);
    row = page.getByRole('listitem').filter({ hasText: title });
    await row.getByRole('button', { name: 'Delete announcement' }).click();
    await expect
      .poll(async () => (await snapshot(page)).announcements.some((a) => a.title === title))
      .toBe(false);
  } finally {
    for (const a of (await snapshot(page)).announcements.filter((a) => a.title === title))
      await page.request.delete(`/admin/announcements/${a.id}`);
    await page.request.post('/admin/announcements/reorder', {
      data: { ids: before.announcements.map((a) => a.id), locale: 'en-US' },
    });
  }
});

test('ordinary visitors cannot use admin APIs and the narrow gallery remains usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page, 'visitor');
  expect((await snapshot(page)).selfId).not.toBe(0);
  expect(
    (
      await page.request.post('/admin/announcements', {
        data: { title: 'Forbidden', contentMd: 'test' },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get('/admin/migrate')).status()).toBe(403);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const sidebar = page.getByRole('dialog', { name: 'Settings' });
  await expect(sidebar).toBeVisible();
  await expect.poll(() => sidebar.evaluate((n) => Math.round(n.getBoundingClientRect().x))).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.keyboard.press('Escape');
  await page.locator('main img').first().click();
  await expect(page.getByRole('dialog', { name: 'Media preview' })).toBeVisible();
});

test('real image transcode handles an unavailable upstream and remains dismissible', async ({
  page,
}) => {
  await enter(page);
  test.skip(
    !process.env['INFOTO_EXPECT_UPLOAD_FAILURE'],
    'Requires an explicitly unavailable upstream.',
  );
  const before = (await snapshot(page)).photos.length;
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(0, 0, 180, 120);
    ctx.fillStyle = '#0a0e1a';
    ctx.fillText(String(Date.now()), 8, 40);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'local-review.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  const retry = page.getByRole('button', { name: 'Retry upload', exact: true });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  const failedCard = retry.locator('xpath=ancestor::div[@role="button"]');
  await expect(failedCard.locator('img')).toHaveAttribute('src', /^blob:/);
  await retry.click();
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await failedCard.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(retry).toHaveCount(0);
  expect((await snapshot(page)).photos).toHaveLength(before);
});
