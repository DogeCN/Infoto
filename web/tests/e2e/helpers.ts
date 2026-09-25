import { expect, type Page } from '@playwright/test';

/**
 * Verification-gate helpers for the real first-entry UI. The local Worker's always-pass secret
 * makes the widget self-solve in a few hundred ms (too brief for toBeVisible), so prepareGate
 * delays the first /sync and flags mounts; expectGate asserts the flag, passGate waits for unmount.
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
    .poll(
      () =>
        page.evaluate(
          () => window.__infotoVerifySeen || Boolean(document.querySelector('[data-verify]')),
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
}

export async function passGate(page: Page): Promise<void> {
  await prepareGate(page);
  await page.goto('/');
  await expectGate(page);
  await expect(page.locator('[data-verify]')).toBeHidden({ timeout: 30_000 });
}
