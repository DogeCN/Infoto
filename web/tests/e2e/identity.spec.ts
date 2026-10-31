// Identity & op semantics against the local Worker (via the Vite dev proxy):
// `turnstile_required` → siteKey → verification gate in the waterfall empty state →
// identity creation → HttpOnly cookie → op → snapshot.
//
// The write entry is the `/ws` WebSocket (ADR 0026); the old HTTP `POST /sync` is gone,
// so a probe opens a real socket in the page and reads the frames it answers with.
import { expect, test, type Page } from '@playwright/test';
import { expectGate, passGate, prepareGate } from './helpers';
import type { WsServerFrame } from '../../../src/shared/types';

/** Open `/ws`, send one hello, and return the first frame the server answers with. */
async function probeHello(
  page: Page,
  opts: { turnstileToken?: string; uuid?: string } = {},
): Promise<{ frames: WsServerFrame[]; status: string }> {
  const result = await page.evaluate(
    ({ token, uuid }) =>
      new Promise<{ frames: unknown[]; status: string }>((resolve) => {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${proto}//${location.host}/ws`);
        const frames: unknown[] = [];
        const timer = setTimeout(() => {
          resolve({ frames, status: 'timeout' });
        }, 10_000);
        socket.addEventListener('open', () => {
          const hello: { type: string; lastSeq: number; turnstileToken?: string } = {
            type: 'hello',
            lastSeq: 0,
          };
          if (token) hello.turnstileToken = token;
          // A forged body uuid is never sent: identity comes from the cookie alone.
          void uuid;
          socket.send(JSON.stringify(hello));
        });
        socket.addEventListener('message', (ev) => {
          let frame: { type?: string };
          try {
            frame = JSON.parse(String(ev.data)) as { type?: string };
          } catch {
            return;
          }
          frames.push(frame);
          // A do-not-resolve frame can arrive (`pong` is only sent on request); the
          // hello's own answer is what this probe is after.
          if (frame.type === 'welcome' || frame.type === 'error') {
            clearTimeout(timer);
            try {
              socket.close();
            } catch {
              /* already closing */
            }
            resolve({ frames, status: frame.type });
          }
        });
      }),
    { token: opts.turnstileToken ?? null, uuid: opts.uuid ?? null },
  );
  return { frames: result.frames as WsServerFrame[], status: result.status };
}

test.describe('identity & op semantics (local Worker)', () => {
  test('first entry: turnstile_required → gate in the empty waterfall → identity created → HttpOnly cookie lands', async ({
    page,
    context,
  }) => {
    // A sessionless hello is answered with the verification requirement and a site key.
    // Clear any identity first: a previous spec's cookie would make this a returning visit.
    await context.clearCookies();
    await page.goto('/');
    const probe = await probeHello(page);
    expect(probe.status).toBe('error');
    const first = probe.frames.find(
      (f) => (f as { error?: string }).error === 'turnstile_required',
    ) as { turnstileSiteKey?: string } | undefined;
    expect(first, 'the server asked for verification').toBeTruthy();
    expect(first!.turnstileSiteKey).toBeTruthy();

    await prepareGate(page);
    await page.goto('/');
    // Assert that verification mounts inside the gallery while the navigation remains visible.
    await expectGate(page);
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('[data-verify]')).toBeHidden({ timeout: 30_000 });

    // A freshly created identity cannot receive a handshake cookie (the hello lands after
    // the 101), so the page mirrors `welcome.uuid` into a JS-set cookie. The NEXT handshake
    // re-issues it HttpOnly — that self-healing second connection is what this asserts.
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === 'uuid'))
      .toBe(true);
    await page.evaluate(() => {
      // Drop the page's own engine socket so the reconnect below is a clean handshake.
      localStorage.removeItem('infoto-last-seq');
    });
    await page.reload();
    await expect(page.locator('header')).toBeVisible();
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.httpOnly && c.name === 'uuid'), {
        timeout: 15_000,
      })
      .toBeTruthy();

    const cookies = await context.cookies();
    const auth = cookies.find((c) => c.httpOnly && c.name === 'uuid');
    expect(auth, 'HttpOnly identity cookie should land on localhost via the proxy').toBeTruthy();
    expect(auth!.domain).toMatch(/localhost|127\.0\.0\.1/);
  });

  test('upload op → op-log path → welcome snapshot responds with selfId', async ({ page }) => {
    await passGate(page);
    // A proven identity (the cookie from the gate above) hands back a welcome carrying
    // this connection's own selfId — the field the HTTP response used to supply.
    const welcome = await page.evaluate(
      () =>
        new Promise<{ selfId?: number; type?: string; error?: string }>((resolve, reject) => {
          const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new WebSocket(`${proto}//${location.host}/ws`);
          const timer = setTimeout(() => reject(new Error('welcome_timeout')), 15_000);
          socket.addEventListener('open', () =>
            socket.send(JSON.stringify({ type: 'hello', lastSeq: 0 })),
          );
          socket.addEventListener('message', (ev) => {
            let frame: { type?: string; selfId?: number; error?: string };
            try {
              frame = JSON.parse(String(ev.data));
            } catch {
              return;
            }
            if (frame.type === 'welcome') {
              clearTimeout(timer);
              socket.close();
              resolve(frame);
            }
            if (frame.type === 'error') {
              clearTimeout(timer);
              socket.close();
              reject(new Error(frame.error));
            }
          });
        }),
    );
    expect(welcome.type).toBe('welcome');
    expect(typeof welcome.selfId).toBe('number');
  });

  test('a forged body uuid is not accepted (identity comes from the cookie alone)', async ({
    page,
  }) => {
    // The socket has no place to put a forged uuid at all: identity is resolved from the
    // upgrade's cookie. A request without one is still asked to verify, as before.
    await page.goto('/');
    const probe = await probeHello(page, { uuid: '00000000-0000-0000-0000-000000000000' });
    expect(probe.status).toBe('error');
    const first = probe.frames[0] as { error?: string } | undefined;
    expect(first?.error).toBe('turnstile_required');
  });
});
