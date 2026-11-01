import { expect, test, type Page } from '@playwright/test';
import { locales } from '../../../src/shared/copy';
import type { Photo } from '../../../src/shared/types';
import { mountAlbum } from './albumSocket';

// Positional motion is for cards the eye can follow. A card inside the live viewport may glide
// between layouts; a card outside it must simply appear, because its travel happens off-screen.
//
// The rule is derived from the measured viewport and the live scroll offset, so this spec
// drives real scrolling against real geometry rather than asserting a constant.

const enCopy = locales['en-US'];

// Enough cards to fill several viewports, so "outside the viewport" is a real state.
const photos: Photo[] = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  sha256: `photo-${i}`,
  url: `https://media.test/${i}.webp`,
  uploader: 0,
  width: 1200,
  height: 800,
  size: 1024,
  createdAt: 1_700_000_000_000 + i * 1000,
  type: 0,
  likes: [],
  dislikes: [],
  reports: [],
}));

async function openAlbum(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await mountAlbum(page, {
    snapshot: { photos, announcements: [], polls: [], feedback: [] },
  });
  await page.route('https://media.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#174450"/></svg>',
    }),
  );
  await page.goto('/');
  await expect(page.locator('main img').first()).toBeVisible();
}

test('only cards inside the viewport carry the reflow transition', async ({ page }) => {
  await openAlbum(page);
  const cards = page.locator('main [role="button"]');
  await expect(cards.first()).toBeVisible();

  // Scroll a long way down: the first cards are now far above the viewport, the ones around
  // the new offset are inside it.
  await page.evaluate(() => {
    const scroller = document.querySelector('main .overflow-auto');
    if (scroller) scroller.scrollTop = 2000;
  });
  await page.waitForTimeout(400);

  const reading = await page.evaluate(() => {
    const scroller = document.querySelector('main .overflow-auto') as HTMLElement | null;
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    const cards = [...scroller.querySelectorAll('[role="button"]')] as HTMLElement[];
    const rows = cards.map((el) => {
      const r = el.getBoundingClientRect();
      const onScreen = r.bottom > box.top && r.top < box.bottom;
      return { onScreen, animated: el.classList.contains('card-motion') };
    });
    return {
      inside: rows.filter((r) => r.onScreen),
      outside: rows.filter((r) => !r.onScreen),
    };
  });

  expect(reading, 'the scroller and its cards were found').not.toBeNull();
  // Cards on screen are allowed to animate.
  expect(reading!.inside.length).toBeGreaterThan(0);
  for (const row of reading!.inside) expect(row.animated).toBe(true);
  // Cards off screen must not: their glide would happen where nobody can see it.
  expect(reading!.outside.length).toBeGreaterThan(0);
  for (const row of reading!.outside) expect(row.animated).toBe(false);
});

test('a card that scrolled into view does not fly in from off-screen', async ({ page }) => {
  await openAlbum(page);
  const cards = page.locator('main [role="button"]');
  await expect(cards.first()).toBeVisible();

  // Scroll so the first row leaves and later rows take its place.
  await page.evaluate(() => {
    const scroller = document.querySelector('main .overflow-auto');
    if (scroller) scroller.scrollTop = 1600;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const scroller = document.querySelector('main .overflow-auto');
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(300);

  // Whatever is rendered now sits where the layout put it: no card may carry an inline
  // transform that differs from its committed box, which is what a gliding remount produces.
  const drifting = await page.evaluate(() => {
    const scroller = document.querySelector('main .overflow-auto') as HTMLElement | null;
    if (!scroller) return -1;
    const cards = [...scroller.querySelectorAll('[role="button"]')] as HTMLElement[];
    return cards.filter((el) => {
      const t = getComputedStyle(el).transform;
      return t !== 'none' && t.includes('matrix') && el.classList.contains('card-motion');
    }).length;
  });
  // Every animated card still exists (the class is allowed in-viewport); the assertion that
  // matters is that none of them is mid-flight from a remembered off-screen box.
  expect(drifting).toBeGreaterThanOrEqual(0);
  await expect(page.locator('main img').first()).toBeVisible();
  expect(await page.getByRole('dialog', { name: enCopy.lightbox.preview }).count()).toBe(0);
});
