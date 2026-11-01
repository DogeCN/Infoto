// Seeded album integration: the real Worker + Durable Object against a seeded local D1.
//
// Opt-in (`INFOTO_SEEDED_TEST`): seeding is a manual step, so CI and a normal local run
// skip these. The write entry is the `/ws` WebSocket (ADR 0026) — the old `POST /sync`
// probes these used are gone — so state reads open a real connection and read its `welcome`
// snapshot.
//
// ⚠️ One connection per user: the Durable Object replaces a user's older socket (4001), so
// every `snapshot()` read kicks the page's own connection until it syncs again. Assertions
// read server state from that fresh connection, and UI state is checked after a reload.
import { expect, test, type Page } from '@playwright/test';
import type { Announcement, Feedback, Op, Poll, Photo } from '../../../src/shared/types';
import { connectRoot, connectVisitor, type LiveAlbum } from './albumSocket';

test.skip(
  !process.env['INFOTO_SEEDED_TEST'],
  'Requires seeded local D1 with the all-zero root UUID.',
);

/** The album state as a real client sees it: the `welcome` snapshot over `/ws`. */
interface AlbumView {
  selfId: number;
  photos: Photo[];
  announcements: Announcement[];
  polls: Poll[];
  feedback: Feedback[];
}

/** Dial the album as `role` and connect the page's own engine (a `goto` first: same-origin). */
async function enter(page: Page, role: 'root' | 'visitor' = 'root'): Promise<LiveAlbum> {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await page.goto('/');
  const { album } = role === 'root' ? await connectRoot(page) : await connectVisitor(page);
  await expect(page.locator('main img').first()).toBeVisible();
  return album;
}

/** Read the present album state over its own connection, then close it. */
async function snapshot(page: Page, role: 'root' | 'visitor' = 'root'): Promise<AlbumView> {
  const { album, welcome } = role === 'root' ? await connectRoot(page) : await connectVisitor(page);
  await album.close();
  return {
    selfId: welcome.selfId,
    photos: welcome.snapshot?.photos ?? [],
    announcements: welcome.snapshot?.announcements ?? [],
    polls: welcome.snapshot?.polls ?? [],
    feedback: welcome.snapshot?.feedback ?? [],
  };
}

/** Root-only cleanup: delete every row this spec created, as ops. */
async function cleanup(album: LiveAlbum, ops: Op[]): Promise<void> {
  if (ops.length > 0) await album.apply(ops);
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

test('independent polls, reactions and feedback persist through real sync and reload', async ({
  page,
}) => {
  const album = await enter(page);
  const before = await snapshot(page);
  const announcementTitle = `Local review announcement ${Date.now()}`;
  const optionA = `First choice ${Date.now()}`;
  const optionB = `Second choice ${Date.now()}`;
  const text = `Local review feedback ${Date.now()}`;
  let pollId: number | undefined;
  let announcementId: number | undefined;

  try {
    // Admin CRUD is a WebSocket op now, so a spec drives it the way a real admin does.
    const createdPoll = await album.apply([
      {
        type: 'poll_create',
        cid: `poll-${Date.now()}`,
        payload: { options: [optionA, optionB], allowMultiple: true, locale: 'en-US' },
      },
    ]);
    expect(createdPoll.dropped).toEqual([]);
    pollId = (createdPoll.applied[0]?.op.payload as { id?: number } | undefined)?.id;
    expect(pollId).toBeGreaterThan(0);

    const createdAnn = await album.apply([
      {
        type: 'ann_create',
        cid: `ann-${Date.now()}`,
        payload: {
          title: announcementTitle,
          contentMd: `Choose below.\n\n::poll:en-US:${pollId}`,
          locale: 'en-US',
        },
      },
    ]);
    expect(createdAnn.dropped).toEqual([]);
    announcementId = (createdAnn.applied[0]?.op.payload as { id?: number } | undefined)?.id;
    expect(announcementId).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('main img').first()).toBeVisible();
    await page.getByRole('button', { name: 'Announcements', exact: true }).click();
    const sidebar = page.getByRole('dialog', { name: 'Announcements' });
    await expect(sidebar.getByRole('button', { name: 'Add reaction', exact: true })).toHaveCount(0);
    await sidebar.getByRole('button', { name: announcementTitle, exact: true }).click();
    await sidebar.getByRole('button', { name: new RegExp(optionB) }).click();
    await sidebar.getByRole('button', { name: 'Add reaction', exact: true }).click();
    await sidebar.getByRole('button', { name: '🔥', exact: true }).click();
    await sidebar.getByPlaceholder('Write your suggestion').fill(text);
    await sidebar.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(sidebar.getByText(text, { exact: true })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Send', exact: true }).click();
    await page.keyboard.press('Escape');
    // The send queued a feedback op; the page flushes it on its own schedule.
    await expect
      .poll(async () => (await snapshot(page)).feedback.some((item) => item.contentMd === text), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.reload();
    await expect(page.locator('main img').first()).toBeVisible();

    const after = await snapshot(page);
    const savedPoll = after.polls.find((item) => item.id === pollId)!;
    const savedAnnouncement = after.announcements.find((item) => item.id === announcementId)!;
    expect(savedPoll.votes).toContainEqual({ userId: before.selfId, option: 1 });
    expect(savedAnnouncement.contentMd).toContain(`::poll:en-US:${pollId}`);
    expect(savedAnnouncement.reactions).toContainEqual({ userId: before.selfId, emoji: '🔥' });
    expect(after.feedback.some((item) => item.contentMd === text)).toBe(true);

    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Feedback', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search feedback' }).fill(text);
    const row = page.getByRole('listitem').filter({ hasText: text });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete feedback' }).click();
    await expect(row).toHaveCount(0);
    await expect
      .poll(async () => (await snapshot(page)).feedback.some((item) => item.contentMd === text))
      .toBe(false);
  } finally {
    const ops: Op[] = [];
    if (announcementId !== undefined)
      ops.push({ type: 'ann_delete', target: announcementId, cid: `c-ann-${Date.now()}` });
    if (pollId !== undefined)
      ops.push({ type: 'poll_delete', target: pollId, cid: `c-poll-${Date.now()}` });
    for (const feedback of (await snapshot(page)).feedback.filter(
      (item) => item.contentMd === text,
    ))
      ops.push({
        type: 'fb_delete',
        target: feedback.id,
        cid: `c-fb-${feedback.id}-${Date.now()}`,
      });
    await cleanup(album, ops);
  }
});

test('admin creates, edits, cancels, reorders, exports and deletes announcements', async ({
  page,
}) => {
  const album = await enter(page);
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
    const ops: Op[] = [
      {
        type: 'ann_reorder',
        cid: `reorder-${Date.now()}`,
        payload: { locale: 'en-US', ids: before.announcements.map((a) => a.id) },
      },
    ];
    for (const a of (await snapshot(page)).announcements.filter((a) => a.title === title))
      ops.unshift({ type: 'ann_delete', target: a.id, cid: `c-${a.id}-${Date.now()}` });
    await cleanup(album, ops);
  }
});

test('ordinary visitors cannot use admin APIs and the narrow gallery remains usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const visitor = await enter(page, 'visitor');
  expect((await snapshot(page, 'visitor')).selfId).not.toBe(0);
  // A non-root admin op is refused before the log — the socket-era equivalent of the 403.
  const refused = await visitor.apply([
    {
      type: 'ann_create',
      cid: `forbidden-${Date.now()}`,
      payload: { title: 'Forbidden', contentMd: 'test', locale: 'en-US' },
    },
  ]);
  expect(refused.dropped.length).toBeGreaterThan(0);
  expect(refused.applied).toEqual([]);
  // /admin/migrate is still an HTTP route, so its status check stands.
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
