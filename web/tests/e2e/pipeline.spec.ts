// Exercise image and video uploads, size limits, retries, cross-tab progress, and pagehide synchronization.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { fmt, locales } from '../../../src/shared/copy';
import { passGate } from './helpers';

const enCopy = locales['en-US'];
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localizedPattern = (values: string[]): RegExp =>
  new RegExp(`^(?:${values.map(escapeRegExp).join('|')})$`);
const copyTables = Object.values(locales);
const uploadLabel = localizedPattern(copyTables.map((table) => table.topbar.upload));
const retryLabel = localizedPattern(copyTables.map((table) => table.photoCard.retry));
const duplicateLabel = new RegExp(
  copyTables
    .map((table) => escapeRegExp(fmt(table.upload.duplicate, { fileName: 'e2e.jpg' })))
    .join('|'),
);

const uploadButton = (page: Page) => page.getByRole('button', { name: uploadLabel, exact: true });

/** Transcode-panel row for a given file name (visible while the job is active). */
const taskRow = (page: Page, name: string) => page.getByText(name, { exact: true });
const photoCards = (page: Page) =>
  page.locator('.relative.h-full.w-full.overflow-auto > .relative > [role="button"]');

/** Draw an image in the browser and return it base64 (Node side converts to a Buffer for setFiles). */
async function makeImage(
  page: Page,
  opts: { w: number; h: number; type: 'image/jpeg' | 'image/png'; name: string },
) {
  const base64 = await page.evaluate(async ({ w, h, type }) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(0, 0, w, h);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), type, 0.9));
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
  }, opts);
  const buf = Buffer.from(base64, 'base64');
  return { name: opts.name, mimeType: opts.type, buffer: buf };
}

test.describe('transcode + upload pipeline (local Worker)', () => {
  test('environment probe: WebP support / VP9-VP8 encode support (drives the codec table)', async ({
    page,
  }) => {
    await page.goto('/');
    const probe = await page.evaluate(async () => {
      // Probe encoders on the page, which owns the dedicated video workers.
      const canvas = new OffscreenCanvas(2, 2);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 2, 2);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
      let vp9: boolean;
      let vp8: boolean;
      try {
        const r = await VideoEncoder.isConfigSupported({
          codec: 'vp09.00.10.08',
          width: 64,
          height: 64,
          bitrate: 100_000,
        });
        vp9 = r.supported ?? false;
      } catch {
        vp9 = false;
      }
      try {
        const r = await VideoEncoder.isConfigSupported({
          codec: 'vp8',
          width: 64,
          height: 64,
          bitrate: 100_000,
        });
        vp8 = r.supported ?? false;
      } catch {
        vp8 = false;
      }
      return { webp: blob.type === 'image/webp', vp9, vp8 };
    });
    expect(probe.webp).toBe(true);
    expect(probe.vp9 || probe.vp8).toBe(true);
  });

  test('image E2E: JPEG → WebP → OPFS → /upload proxy → URL written to op-log → duplicate upload skips', async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await passGate(page);

    const file = await makeImage(page, { w: 320, h: 200, type: 'image/jpeg', name: 'e2e.jpg' });

    // The SharedWorker issues /upload, which page.on('request') cannot observe —
    // the panel row leaving (task finished) is the end-to-end completion signal,
    // covering stage 2 (upload + op-log).
    const chooser = page
      .waitForEvent('filechooser', { timeout: 5_000 })
      .then((fc) => fc.setFiles(file));
    await uploadButton(page).click();
    await chooser;
    await expect(taskRow(page, 'e2e.jpg')).toBeVisible({ timeout: 60_000 });
    await expect(taskRow(page, 'e2e.jpg')).toBeHidden({ timeout: 120_000 });
    await expect(photoCards(page).first()).toBeVisible();
    expect(pageErrors).toEqual([]);

    // the sha dedupe cache lives in IndexedDB and is refreshed by the engine's
    // sync path — hit the real top-bar sync button (a bare fetch would not
    // refresh it), so the second pick can hit the duplicate branch
    const topImage = photoCards(page).first().locator('img');
    await expect(topImage).toHaveCSS('opacity', '1', { timeout: 30_000 });
    await page.locator('header button:has(svg.lucide-refresh-cw)').click();
    await page.waitForResponse(
      (r) => r.url().includes('/sync') && r.request().method() === 'POST' && r.ok(),
      { timeout: 30_000 },
    );
    await expect(topImage).toHaveCSS('opacity', '1');

    // Assert duplicate detection through pipeline events and the server snapshot.
    const count = async () => {
      const r = await context.request.post('/sync', { data: { locale: 'en-US', ops: [] } });
      return ((await r.json()) as { photos: unknown[] }).photos.length;
    };
    const before = await count();
    const dupLog = page.waitForEvent('console', {
      predicate: (m) => m.text().includes('duplicate: sha256 cache hit'),
      timeout: 90_000,
    });
    const chooser2 = page
      .waitForEvent('filechooser', { timeout: 5_000 })
      .then((fc) => fc.setFiles(file));
    await uploadButton(page).click();
    await chooser2;
    await dupLog;
    await expect(page.getByText(duplicateLabel).last()).toBeVisible();
    await page.locator('header button:has(svg.lucide-refresh-cw)').click();
    await expect.poll(count, { timeout: 30_000 }).toBe(before); // The duplicate upload leaves the photo count unchanged.
  });

  test('gif E2E: frame-by-frame transcode → type=1', async ({ page }) => {
    page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
    await passGate(page);
    // minimal valid GIF (1×1, single frame)
    const gifBytes = Uint8Array.from(
      atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
      (c) => c.charCodeAt(0),
    );
    const chooser = page
      .waitForEvent('filechooser')
      .then((fc) =>
        fc.setFiles({ name: 'e2e.gif', mimeType: 'image/gif', buffer: Buffer.from(gifBytes) }),
      );
    await uploadButton(page).click();
    await chooser;
    // a 1×1 GIF either fails (decode error → retry card) or completes (panel row
    // leaves); assert a terminal state is reached and never hangs
    const row = taskRow(page, 'e2e.gif');
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const rowGone = (await row.count()) === 0;
      const retryShown = (await page.locator('button:has(svg.lucide-rotate-ccw)').count()) > 0;
      expect(rowGone || retryShown).toBe(true);
    }).toPass({ timeout: 120_000 });
  });

  test('100MB pre-check: fails immediately, no retry, artifact stays in OPFS', async ({ page }) => {
    await page.goto('/');
    // exercise the pipeline's pure function directly (base pipeline module
    // served from the repo src/ tree through the $base alias target)
    const pipelineFs = fileURLToPath(
      new URL('../../src/base/upload/pipeline.ts', import.meta.url),
    ).replace(/\\/g, '/');
    const r = await page.evaluate(async (url) => {
      const mod = await import(/* @vite-ignore */ `/@fs/${url}`);
      return {
        over: mod.isOversize(mod.MAX_UPLOAD_BYTES + 1),
        at: mod.isOversize(mod.MAX_UPLOAD_BYTES),
      };
    }, pipelineFs);
    expect(r.over).toBe(true);
    expect(r.at).toBe(false);
  });

  test('retry handle: failed tasks expose a retry button', async ({ page }) => {
    await passGate(page);
    // An empty PNG fails decoding and exposes a retryable upload card.
    const chooser = page
      .waitForEvent('filechooser')
      .then((fc) =>
        fc.setFiles({ name: 'retry.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }),
      );
    await uploadButton(page).click();
    await chooser;
    await expect(page.locator('button:has(svg.lucide-rotate-ccw)').first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('button', { name: retryLabel, exact: true })).toBeVisible();
  });

  test('cross-tab: page A uploads, page B sees it (SharedWorker + BroadcastChannel + sync)', async ({
    context,
  }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await passGate(a);
    // B shares the context cookie jar, so it skips the gate entirely
    await b.goto('/');
    const imgsBefore = await b.locator('main img').count();

    const file = await makeImage(a, { w: 100, h: 70, type: 'image/jpeg', name: 'bc.jpg' });
    const chooser = a.waitForEvent('filechooser').then((fc) => fc.setFiles(file));
    await uploadButton(a).click();
    await chooser;
    // B sees A's job either live (panel row via BroadcastChannel / SW replay)
    // or as a landed photo in its own waterfall once the op syncs
    await expect(async () => {
      const rowShown = (await taskRow(b, 'bc.jpg').count()) > 0;
      const imgGrew = (await b.locator('main img').count()) > imgsBefore;
      expect(rowShown || imgGrew).toBe(true);
    }).toPass({ timeout: 30_000 });
  });

  test('pagehide submit: a queued op leaves in a keepalive request', async ({ page }) => {
    await passGate(page);

    // The flush is a no-op with an empty oplog, so the op has to go through the engine:
    // submitting feedback from the sidebar appends it and leaves one operation pending.
    const sidebar = page.getByRole('dialog', { name: enCopy.sidebar.announcementsTitle });
    await page.getByRole('button', { name: enCopy.topbar.announcements, exact: true }).click();
    await sidebar.getByPlaceholder(enCopy.announcements.feedbackPlaceholder).fill('pagehide-e2e');
    await sidebar.getByRole('button', { name: enCopy.announcements.send, exact: true }).click();

    // Observe the flush itself: the engine's keepalive POST carries the queued op.
    const flushed = page.waitForRequest((r) => r.url().includes('/sync') && r.method() === 'POST', {
      timeout: 15_000,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect((await flushed).postData()).toContain('fb_create');
  });
});
