// Identity & op semantics against the local Worker (via the Vite dev proxy):
// 401 → siteKey → verification gate in the waterfall empty state → identity
// creation → HttpOnly cookie → op → snapshot.
import { expect, test, type Page } from '@playwright/test';

/**
 * Walk a fresh visitor through the verification gate. The local Worker runs
 * Cloudflare's always-pass test secret, so the widget solves itself — the test
 * drives the real first-entry UI: the gate renders inside the main area (the
 * waterfall is empty for a new visitor), then fades out once the snapshot lands.
 *
 * The gate stays in the DOM (opacity-0) through its fade-out, so `toBeVisible`
 * holds into the "done" state; only after the widget is disposed does the node
 * unmount and `toBeHidden` flip.
 */
async function passGate(page: Page) {
	await page.goto('/');
	await expect(page.locator('[data-verify]')).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('[data-verify]')).toBeHidden({ timeout: 30_000 });
}

test.describe('identity & op semantics (local Worker)', () => {
	test('first entry: 401 turnstile_required → gate in the empty waterfall → identity created → HttpOnly cookie lands', async ({
		page,
		context,
	}) => {
		// first /sync without a cookie must return 401 turnstile_required + siteKey
		// (proxied through). Probe before opening the page so the automated
		// always-pass verification can never race ahead and land a cookie first.
		const probe = await context.request.post('/sync', { data: { ops: [] } });
		const body = (await probe.json().catch(() => ({}))) as { error?: string; turnstileSiteKey?: string };
		expect(probe.status()).toBe(401);
		expect(body.error).toBe('turnstile_required');
		expect(body.turnstileSiteKey).toBeTruthy();

		await page.goto('/');
		// the gate renders inside the main area (the bare Turnstile widget, no
		// extra copy) — the app shell (top bar) stays visible instead of being
		// covered by a full-screen overlay
		await expect(page.locator('[data-verify]')).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('header')).toBeVisible();

		await passGate(page);

		// cookie landed and HttpOnly
		const cookies = await context.cookies();
		const auth = cookies.find((c) => c.httpOnly && c.name === 'uuid');
		expect(auth, 'HttpOnly identity cookie should land on localhost via the proxy').toBeTruthy();
		expect(auth!.domain).toMatch(/localhost|127\.0\.0\.1/);
	});

	test('upload op → op-log path → /sync → snapshot responds with selfId', async ({ page }) => {
		await passGate(page);
		// the client must never send a uuid field: post an upload op directly and check the reply
		const like = await page.evaluate(async () => {
			const r = await fetch('/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ops: [{ type: 'upload', target: null, payload: { sha256: 'e2e-like-test', url: 'https://host/x.webp', width: 1, height: 1, size: 1, type: 0 } }] }),
			});
			const body = await r.json();
			return { status: r.status, selfId: body.selfId };
		});
		expect(like.status).toBe(200);
		expect(typeof like.selfId).toBe('number');
	});

	test('forged body uuid is not accepted (still treated as cookie identity)', async ({ page, context }) => {
		const r = await context.request.post('/sync', {
			data: { ops: [], uuid: '00000000-0000-0000-0000-000000000000' },
		});
		const body = (await r.json().catch(() => ({}))) as { error?: string };
		// contract re-check: a forged uuid without a cookie still goes through Turnstile
		expect(r.status()).toBe(401);
		expect(body.error).toBe('turnstile_required');
	});
});
