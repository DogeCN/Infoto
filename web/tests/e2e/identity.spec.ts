// Identity & op semantics against the real test deployment (via the Vite
// dev proxy): 401 → siteKey → identity creation → cookie → op → snapshot.
import { expect, test } from '@playwright/test';

test.describe('identity & op semantics (test deployment)', () => {
	test('first entry: 401 turnstile_required → identity created → HttpOnly cookie lands', async ({ page, context }) => {
		await page.goto('/');
		// first /sync without a cookie must return 401 turnstile_required + siteKey
		// (proxied through). context.request shares the browser cookie jar and is
		// immune to the Vite dev-server's occasional HMR full-reload, which would
		// destroy a page.evaluate execution context mid-fetch.
		const probe = await context.request.post('/sync', { data: { ops: [] } });
		const body = (await probe.json().catch(() => ({}))) as { error?: string; turnstileSiteKey?: string };
		expect(probe.status()).toBe(401);
		expect(body.error).toBe('turnstile_required');
		expect(body.turnstileSiteKey).toBeTruthy();

		// harness e2e branch: fake token → identity created
		await page.goto('/?e2e=1');
		await page.getByRole('button', { name: /identity/ }).click();
		await expect(page.getByText(/selfId=\d+/)).toBeVisible({ timeout: 15_000 });

		// cookie landed and HttpOnly
		const cookies = await context.cookies();
		const auth = cookies.find((c) => c.httpOnly && c.name === 'uuid');
		expect(auth, 'HttpOnly identity cookie should land on localhost via the proxy').toBeTruthy();
		expect(auth!.domain).toMatch(/localhost|127\.0\.0\.1/);
	});

	test('upload op → op-log path → /sync → snapshot responds with selfId', async ({ page }) => {
		await page.goto('/?e2e=1');
		await page.getByRole('button', { name: /identity/ }).click();
		await expect(page.getByText(/selfId=\d+/)).toBeVisible({ timeout: 15_000 });

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
