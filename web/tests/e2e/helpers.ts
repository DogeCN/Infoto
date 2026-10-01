import { expect, type Page } from '@playwright/test';

// Delay the first sync to observe verification mounting, then wait for disposal.

declare global {
  interface Window {
    __infotoVerifySeen?: boolean;
  }
}

export async function prepareGate(page: Page): Promise<void> {
  let delayed = false;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.turnstile = (() => {
          const widgets = new Map();
          let nextId = 0;
          return {
            render(container, options) {
              const id = String(++nextId);
              const marker = document.createElement('div');
              marker.dataset.turnstileMock = 'true';
              marker.textContent = 'Local verification passed';
              container.appendChild(marker);
              widgets.set(id, marker);
              setTimeout(() => options.callback?.('local-e2e-token'), 25);
              return id;
            },
            reset() {},
            remove(id) {
              widgets.get(id)?.remove();
              widgets.delete(id);
            },
          };
        })();
      `,
    }),
  );
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
  await page.goto('/?t=' + Date.now());
  await expectGate(page);
  await expect(page.locator('[data-verify]')).toBeHidden({ timeout: 30_000 });
}
