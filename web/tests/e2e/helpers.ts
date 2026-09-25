import { expect, type Page } from '@playwright/test';

/**
 * Verification-gate helpers for specs that drive the real first-entry UI.
 *
 * The local Worker runs Cloudflare's always-pass test secret, so the widget
 * solves itself a few hundred ms after mounting — the gate's visible window is
 * too brief to assert with `toBeVisible`. Instead, `prepareGate` delays the
 * first `/sync` (stretching the 401 → gate render path) and records mounts via
 * a sticky MutationObserver flag, `expectGate` asserts that flag, and
 * `passGate` waits for the widget to unmount before the spec drives the UI.
 */

declare global {
  interface Window {
    __infotoVerifySeen?: boolean;
  }
}

export async function prepareGate(page: Page): Promise<void> {
  let delayed = false;
  await page.route('**/sync', async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__infotoVerifySeen = false;
    const markSeen = () => {
      if (document.querySelector('[data-verify]')) window.__infotoVerifySeen = true;
    };
    new MutationObserver(markSeen).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', markSeen, { once: true });
  });
}

export async function expectGate(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__infotoVerifySeen || Boolean(document.querySelector('[data-verify]'))), {
      timeout: 15_000,
    })
    .toBe(true);
}

export async function passGate(page: Page): Promise<void> {
  await prepareGate(page);
  await page.goto('/');
  await expectGate(page);
  await expect(page.locator('[data-verify]')).toBeHidden({ timeout: 30_000 });
}
