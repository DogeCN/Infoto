import { describe, expect, it, vi } from 'vitest';
import { LeaseClient } from '../../src/transcode/lease';
import type { SwToPageMessage } from '../../src/transcode/shared/protocol';
import { postSync } from '../../src/core/api/syncClient';
import { postUpload } from '../../src/core/api/uploadClient';

// ---- syncClient -----------------------------------------------------------------

const okResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('syncClient', () => {
	it('surfaces turnstile_required with siteKey', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			okResponse({ ok: false, error: 'turnstile_required', turnstileSiteKey: 'key-1' }, 401),
		);
		await expect(postSync({ ops: [] }, { fetchFn, origin: 'http://x' })).rejects.toMatchObject({
			name: 'TurnstileRequiredError',
			turnstileSiteKey: 'key-1',
		});
		const call = fetchFn.mock.calls[0]!;
		const body = JSON.parse(call[1].body);
		expect(Object.keys(body)).not.toContain('uuid'); // contract: no uuid in the request body
	});

	it('surfaces turnstile_failed', async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse({ ok: false, error: 'turnstile_failed' }, 401));
		await expect(postSync({ ops: [] }, { fetchFn, origin: 'http://x' })).rejects.toMatchObject({ name: 'TurnstileFailedError' });
	});

	it('passes camelCase response through untouched', async () => {
		const body = { ok: true, serverTime: 1, selfId: 0, photos: [], announcements: [], feedback: [] };
		const fetchFn = vi.fn().mockResolvedValue(okResponse(body));
		const { response } = await postSync({ ops: [] }, { fetchFn, origin: 'http://x' });
		expect(response).toEqual(body);
	});
});

// ---- uploadClient ---------------------------------------------------------------

describe('uploadClient', () => {
	it('returns data url on success', async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse({ data: 'https://host/f.webp' }));
		const r = await postUpload(new Blob(['x'], { type: 'image/webp' }), { fetchFn, origin: 'http://x' });
		expect(r).toEqual({ ok: true, url: 'https://host/f.webp' });
		const [url, init] = fetchFn.mock.calls[0]!;
		expect(url).toBe('http://x/upload');
		expect(init.body).toBeInstanceOf(FormData);
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('maps http errors to stable codes', async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse({ error: 'unauthorized' }, 401));
		const r = await postUpload(new Blob(['x']), { fetchFn, origin: 'http://x' });
		expect(r).toMatchObject({ ok: false, error: 'unauthorized' });
	});

	it('maps timeout to a failed attempt', async () => {
		const fetchFn = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			}),
		);
		const r = await postUpload(new Blob(['x']), { fetchFn, origin: 'http://x', timeoutMs: 10 });
		expect(r).toMatchObject({ ok: false, error: 'timeout' });
	});
});

// ---- LeaseClient 生命周期（契约四条自查的可测版本） ----------------------------------

describe('LeaseClient lifecycle', () => {
	const granted = (leaseId = 'l1'): SwToPageMessage => ({
		t: 'leaseGranted',
		leaseId,
		jobId: 'j1',
		file: new Blob(),
		mime: 'video/mp4',
		fileName: 'a.mp4',
	});

	function makeClient() {
		const posted: unknown[] = [];
		const port = { postMessage: (m: unknown) => posted.push(m) };
		const client = new LeaseClient(port, { onGranted: vi.fn(), onRevoked: vi.fn() });
		return { posted, client };
	}

	it('heartbeats every lease interval while held, stops after release', () => {
		vi.useFakeTimers();
		const { posted, client } = makeClient();
		client.handleMessage(granted());
		vi.advanceTimersByTime(12_000);
		const beats = posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat');
		expect(beats.length).toBeGreaterThanOrEqual(2); // 5s 周期
		client.release();
		expect(posted.some((m) => (m as { t: string }).t === 'leaseRelease')).toBe(true);
		const beatsAfter = posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length;
		vi.advanceTimersByTime(12_000);
		expect(posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length).toBe(beatsAfter);
		vi.useRealTimers();
	});

	it('release before grant is a no-op', () => {
		const { posted, client } = makeClient();
		client.release();
		expect(posted).toHaveLength(0);
	});

	it('revocation clears local lease state', () => {
		const { client } = makeClient();
		client.handleMessage(granted());
		client.handleMessage({ t: 'leaseRevoked', leaseId: 'l1', jobId: 'j1' });
		expect(client.heldJobId).toBeNull();
	});
});