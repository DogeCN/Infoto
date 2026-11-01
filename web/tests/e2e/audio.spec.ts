/**
 * One open sound for the whole page.
 *
 * The waterfall's volume buttons are a single shared channel (unmuting one card silences the
 * others), and the Lightbox shows and controls the same state as the card it was opened from.
 *
 * Media requests are left **pending** on purpose. A real video fixture would only prove that
 * the element decodes; the state under test is the `muted` property plus the control labels,
 * and a pending request keeps the card's `onerror` from firing so the volume button stays
 * rendered. The cards still have their full click surface.
 */
import { expect, test, type Page } from '@playwright/test';
import { locales } from '../../../src/shared/copy';
import { mountAlbum } from './albumSocket';
import type { Photo } from '../../../src/shared/types';

const enCopy = locales['en-US'];
const unmuteName = enCopy.lightbox.unmute;
const muteName = enCopy.lightbox.mute;

const photos: Photo[] = Array.from({ length: 2 }, (_, index) => ({
  id: index + 1,
  sha256: `video-${index}`,
  url: `https://media.test/${index}.webm`,
  uploader: 0,
  width: 1200,
  height: 800,
  size: 2048,
  createdAt: 1_700_000_000_000 + index * 1000,
  type: 2,
  likes: [],
  dislikes: [],
  reports: [],
}));

async function mockAlbum(page: Page) {
  await page.addInitScript(() => localStorage.setItem('infoto-locale', 'en-US'));
  await mountAlbum(page, {
    selfId: 7,
    snapshot: { photos, announcements: [], polls: [], feedback: [] },
  });
  // Never fulfilled: see the header comment.
  await page.route('https://media.test/**', () => {});
}

test.use({ viewport: { width: 1280, height: 800 } });

async function openAlbum(page: Page) {
  await mockAlbum(page);
  await page.goto('/');
  const cards = page.locator('main [role="button"]');
  await expect(cards).toHaveCount(2);
  return cards;
}

test('unmuting a second card silences the first, and the Lightbox mirrors the card', async ({
  page,
}) => {
  const cards = await openAlbum(page);
  const cardA = cards.nth(0);
  const cardB = cards.nth(1);

  await cardA.getByRole('button', { name: unmuteName, exact: true }).click();
  await expect(cardA.locator('video')).toHaveJSProperty('muted', false);
  await expect(cardB.locator('video')).toHaveJSProperty('muted', true);

  await cardB.getByRole('button', { name: unmuteName, exact: true }).click();
  await expect(cardA.locator('video')).toHaveJSProperty('muted', true);
  await expect(cardB.locator('video')).toHaveJSProperty('muted', false);

  // Opening the card in the viewer must not create a second player: the viewer takes the
  // open sound over and the card behind it goes quiet.
  await cardB.click();
  const lightbox = page.getByRole('dialog', { name: enCopy.lightbox.preview });
  await expect(lightbox.locator('video')).toBeAttached();
  await expect(lightbox.locator('video')).toHaveJSProperty('muted', false);
  await expect(cardB.locator('video')).toHaveJSProperty('muted', true);
  // The corner control reads "Mute", i.e. sound is open.
  await expect(lightbox.getByRole('button', { name: muteName, exact: true })).toBeVisible();

  // Turning it off in the viewer leaves the card off after closing.
  await lightbox.getByRole('button', { name: muteName, exact: true }).click();
  await expect(lightbox.locator('video')).toHaveJSProperty('muted', true);
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(cardB.locator('video')).toHaveJSProperty('muted', true);
});

test('sound opened in the Lightbox stays open on the card after closing', async ({ page }) => {
  const cards = await openAlbum(page);
  const cardB = cards.nth(1);

  await cardB.click();
  const lightbox = page.getByRole('dialog', { name: enCopy.lightbox.preview });
  await expect(lightbox.locator('video')).toBeAttached();
  await expect(lightbox.locator('video')).toHaveJSProperty('muted', true);

  // The viewer owns the state: opening the sound here is the same open sound the grid shows.
  await lightbox.getByRole('button', { name: unmuteName, exact: true }).click();
  await expect(lightbox.locator('video')).toHaveJSProperty('muted', false);
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(cardB.locator('video')).toHaveJSProperty('muted', false);
  await expect(cards.nth(0).locator('video')).toHaveJSProperty('muted', true);
});

test('the viewer leaves a sound that belongs to another media alone', async ({ page }) => {
  const cards = await openAlbum(page);
  const cardA = cards.nth(0);
  const cardB = cards.nth(1);

  await cardA.getByRole('button', { name: unmuteName, exact: true }).click();
  await expect(cardA.locator('video')).toHaveJSProperty('muted', false);

  // Viewing a DIFFERENT photo must not silence audio the user deliberately opened. Browsing
  // is not a request to stop the sound; only a deliberate unmute elsewhere moves it, or the
  // close. The card keeps playing it (muted or not is its own surface's business) rather
  // than being torn down, because a pause/play here is an audible gap across the transition.
  await cardB.click();
  const lightbox = page.getByRole('dialog', { name: enCopy.lightbox.preview });
  await expect(lightbox.locator('video')).toHaveJSProperty('muted', true);
  await expect(cardA.locator('video')).toHaveJSProperty('muted', false);
  // The viewer offers its own unmute, which would take the sound over from the card.
  await expect(lightbox.getByRole('button', { name: unmuteName, exact: true })).toBeVisible();
});
