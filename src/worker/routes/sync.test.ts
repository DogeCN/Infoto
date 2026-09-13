import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.ts';
import { openLocalDb } from '../../local/d1-shim.ts';
import type { SyncResponse } from '../../shared/types.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');

// Siteverify stub (contract: no allow-branch — identity creation always goes
// through verification). Toggle via siteverifySuccess; everything else passes
// through to the real fetch.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
let siteverifySuccess = true;
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
	if (url === VERIFY_URL) {
		return new Response(JSON.stringify({ success: siteverifySuccess }), { status: 200 });
	}
	return origFetch(input as never, init);
}) as typeof fetch;

const TEST_SECRET = 'test-secret';

function makeApp() {
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const app = createApp({ db, turnstileSecret: TEST_SECRET });
	return { db, app };
}

/** Identity-creating empty sync (fake token; the stub verifies it as ok). */
function syncNew(app: ReturnType<typeof createApp>, cookie?: string): Promise<Response> {
	return sync(app, { ops: [], turnstileToken: 'ok' }, cookie);
}

function cookieFrom(res: Response): string {
	const raw = res.headers.get('set-cookie') ?? '';
	const m = raw.match(/uuid=([^;]+)/);
	assert.ok(m, 'Set-Cookie uuid');
	return `uuid=${m[1]}`;
}

async function sync(app: ReturnType<typeof createApp>, body: unknown, cookie?: string): Promise<Response> {
	return app.request('http://localhost/sync', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});
}

test('no token → 401 turnstile_required; secret-less deployments fail closed (no allow branch)', async () => {
	const { app } = makeApp();
	const res = await sync(app, { ops: [] });
	assert.equal(res.status, 401);
	assert.deepEqual(await res.json(), { ok: false, error: 'turnstile_required', turnstileSiteKey: null });

	// a token against a secret-less deployment must NOT slip through either
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const bare = createApp({ db });
	const res2 = await sync(bare, { ops: [], turnstileToken: 'ok' });
	assert.equal(res2.status, 401);
	assert.deepEqual(await res2.json(), { ok: false, error: 'turnstile_failed' });
});

test('first identity: fake token ok, selfId 0, camelCase, no users, empty feedback', async () => {
	const { app } = makeApp();
	const res = await syncNew(app);
	assert.equal(res.status, 200);
	const json = (await res.json()) as SyncResponse & { users?: unknown; reactions?: unknown };
	assert.equal(json.ok, true);
	assert.equal(json.selfId, 0);
	assert.equal(typeof json.serverTime, 'number');
	assert.deepEqual(json.photos, []);
	assert.deepEqual(json.announcements, []);
	assert.deepEqual(json.feedback, []);
	assert.equal('users' in json, false);
	assert.equal('reactions' in json, false);
	const set = res.headers.get('set-cookie') ?? '';
	assert.ok(set.includes('HttpOnly'));
	assert.ok(set.includes('SameSite=Lax'));
	assert.ok(!set.includes('Secure'));
});

test('secret configured, no token → turnstile_required', async () => {
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const app = createApp({ db, turnstileSecret: 'sk' });
	const res = await sync(app, { ops: [] });
	assert.equal(res.status, 401);
	assert.deepEqual(await res.json(), { ok: false, error: 'turnstile_required', turnstileSiteKey: null });
});

test('body uuid is ignored; still requires turnstile', async () => {
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const app = createApp({ db, turnstileSecret: 'sk', turnstileSiteKey: 'site-key' });
	const res = await sync(app, { uuid: '00000000-0000-4000-8000-000000000000', ops: [] });
	assert.equal(res.status, 401);
	assert.deepEqual(await res.json(), {
		ok: false,
		error: 'turnstile_required',
		turnstileSiteKey: 'site-key',
	});
});

test('bad turnstile token → turnstile_failed', async () => {
	siteverifySuccess = false;
	try {
		const { app } = makeApp();
		const res = await sync(app, { turnstileToken: 'bad', ops: [] });
		assert.equal(res.status, 401);
		assert.deepEqual(await res.json(), { ok: false, error: 'turnstile_failed' });
	} finally {
		siteverifySuccess = true;
	}
});

test('upload, sha collision silent, missing fields silent, created_at/uploader ignored', async () => {
	const { app } = makeApp();
	const first = await syncNew(app);
	const cookie = cookieFrom(first);
	const payload = {
		sha256: 'abc',
		url: 'https://host/x.webp',
		width: 10,
		height: 20,
		size: 123,
		type: 0,
		created_at: 1,
		uploader: 99,
	};
	const res = await sync(
		app,
		{
			ops: [
				{ type: 'upload', payload },
				{ type: 'upload', payload },
				{ type: 'upload', payload: { sha256: 'nope' } },
			],
		},
		cookie,
	);
	const json = (await res.json()) as SyncResponse;
	assert.equal(json.photos.length, 1);
	assert.equal(json.photos[0]!.sha256, 'abc');
	assert.equal(json.photos[0]!.uploader, 0);
	assert.notEqual(json.photos[0]!.createdAt, 1);
	assert.equal(typeof json.photos[0]!.createdAt, 'number');
	assert.equal(json.photos[0]!.id, 1);
});

test('unupload is discarded; like from same batch still applies', async () => {
	const { app } = makeApp();
	const cookie = cookieFrom(await syncNew(app));
	const res = await sync(
		app,
		{
			ops: [
				{
					type: 'upload',
					payload: { sha256: 'h', url: 'https://h', width: 1, height: 1, size: 1, type: 0 },
				},
				{ type: 'unupload' as unknown as 'like', target: 1 },
				{ type: 'like', target: 1 },
			],
		},
		cookie,
	);
	const json = (await res.json()) as SyncResponse;
	assert.equal(json.photos.length, 1);
	assert.deepEqual(json.photos[0]!.likes, [0]);
});

test('non-root delete/ann_create silent; like in same batch works; feedback hidden', async () => {
	const { app } = makeApp();
	const rootCookie = cookieFrom(await syncNew(app));
	await sync(
		app,
		{
			ops: [
				{
					type: 'upload',
					payload: { sha256: 'p', url: 'https://p', width: 1, height: 1, size: 1, type: 0 },
				},
			],
		},
		rootCookie,
	);
	const guest = await syncNew(app);
	assert.equal(((await guest.json()) as SyncResponse).selfId, 1);
	const guestCookie = cookieFrom(guest);
	const res = await sync(
		app,
		{
			ops: [
				{ type: 'delete', target: 1 },
				{ type: 'ann_create', payload: { title: 't', contentMd: 'c' } },
				{ type: 'like', target: 1 },
				{ type: 'fb_create', payload: { contentMd: 'hello' } },
			],
		},
		guestCookie,
	);
	const json = (await res.json()) as SyncResponse;
	assert.equal(json.selfId, 1);
	assert.equal(json.photos.length, 1);
	assert.deepEqual(json.photos[0]!.likes, [1]);
	assert.deepEqual(json.announcements, []);
	assert.deepEqual(json.feedback, []);
	const asRoot = (await (await syncNew(app, rootCookie)).json()) as SyncResponse;
	assert.equal(asRoot.feedback.length, 1);
	assert.equal(asRoot.feedback[0]!.userId, 1);
	assert.equal(asRoot.feedback[0]!.contentMd, 'hello');
});

test('announcements embed reactions; missing update silent; delete cascades; reorder strips NaN', async () => {
	const { app } = makeApp();
	const cookie = cookieFrom(await syncNew(app));
	await sync(
		app,
		{
			ops: [
				{ type: 'ann_create', payload: { title: 'a', contentMd: '1' } },
				{ type: 'ann_create', payload: { title: 'b', contentMd: '2' } },
				{ type: 'react', target: 1, payload: { emoji: '👍' } },
			],
		},
		cookie,
	);
	const mid = (await (await sync(app, { ops: [{ type: 'ann_update', target: 999, payload: { title: 'x', contentMd: 'y' } }] }, cookie)).json()) as SyncResponse;
	assert.equal(mid.announcements.length, 2);
	assert.deepEqual(mid.announcements[0]!.reactions, [{ userId: 0, emoji: '👍' }]);
	assert.equal(mid.announcements[0]!.contentMd, '1');
	assert.equal(mid.announcements[0]!.title, 'a');

	const afterDel = (await (
		await sync(app, { ops: [{ type: 'ann_delete', target: 1 }] }, cookie)
	).json()) as SyncResponse;
	assert.equal(afterDel.announcements.length, 1);
	assert.deepEqual(afterDel.announcements[0]!.reactions, []);

	await sync(app, { ops: [{ type: 'ann_create', payload: { title: 'c', contentMd: '3' } }] }, cookie);
	const reordered = (await (
		await sync(
			app,
			{ ops: [{ type: 'ann_reorder', payload: ['3', 3, null, { x: 1 }, 'not-a-number', 2] as unknown as number[] }] },
			cookie,
		)
	).json()) as SyncResponse;
	assert.deepEqual(
		reordered.announcements.map((a) => a.id),
		[3, 2],
	);
	assert.deepEqual(
		reordered.announcements.map((a) => a.sort),
		[0, 1],
	);
});

test('vote: cast / overwrite / retract; nonexistent target skipped; ann_delete cascades', async () => {
	const { app } = makeApp();
	const rootCookie = cookieFrom(await syncNew(app));
	await sync(app, { ops: [{ type: 'ann_create', payload: { title: 'poll', contentMd: ':::vote 好 | 不好' } }] }, rootCookie);
	const guest = cookieFrom(await syncNew(app));

	// any user may vote; target = announcement id, option = 0-based choice
	let snap = (await (
		await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: 1 } }] }, guest)
	).json()) as SyncResponse;
	assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 1 }]);

	// re-vote overwrites the single per-user row
	snap = (await (await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: 0 } }] }, guest)).json()) as SyncResponse;
	assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 0 }]);

	// option null retracts; a second retract is a silent no-op
	snap = (await (await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: null } }] }, guest)).json()) as SyncResponse;
	assert.deepEqual(snap.announcements[0]!.votes, []);
	snap = (await (await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: null } }] }, guest)).json()) as SyncResponse;
	assert.deepEqual(snap.announcements[0]!.votes, []);

	// nonexistent announcement → silently skipped (no orphan rows);
	// malformed option (non-integer) → silently dropped
	snap = (await (
		await sync(
			app,
			{
				ops: [
					{ type: 'vote', target: 999, payload: { option: 0 } },
					{ type: 'vote', target: 1, payload: { option: 1.5 } },
					{ type: 'vote', target: 1, payload: { option: 1 } },
				],
			},
			guest,
		)
	).json()) as SyncResponse;
	assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 1 }]);

	// ann_delete cascades the votes rows too
	snap = (await (await sync(app, { ops: [{ type: 'ann_delete', target: 1 }] }, rootCookie)).json()) as SyncResponse;
	assert.equal(snap.announcements.length, 0);
	await sync(app, { ops: [{ type: 'ann_create', payload: { title: 'next', contentMd: 'n' } }] }, rootCookie);
	const fresh = (await (await syncNew(app, rootCookie)).json()) as SyncResponse;
	assert.deepEqual(fresh.announcements[0]!.votes, []);
	assert.deepEqual(fresh.announcements[0]!.reactions, []);
});

test('upload without multipart → 400; no cookie → 401', async () => {
	const { app } = makeApp();
	const noAuth = await app.request('http://localhost/upload', { method: 'POST', body: 'x' });
	assert.equal(noAuth.status, 401);
	const cookie = cookieFrom(await syncNew(app));
	const badCt = await app.request('http://localhost/upload', {
		method: 'POST',
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		body: '{}',
	});
	assert.equal(badCt.status, 400);
	assert.deepEqual(await badCt.json(), { ok: false, error: 'bad_content_type' });
	const noSecret = await app.request('http://localhost/upload', {
		method: 'POST',
		headers: { Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=x' },
		body: '--x--',
	});
	assert.equal(noSecret.status, 500);
	assert.deepEqual(await noSecret.json(), { ok: false, error: 'tc_secret_missing' });
});

test('non-root admin and migrate are custom 404', async () => {
	const { app } = makeApp();
	cookieFrom(await syncNew(app));
	const guest = cookieFrom(await syncNew(app));
	for (const url of ['http://localhost/admin', 'http://localhost/admin/migrate']) {
		const res = await app.request(url, { headers: { Cookie: guest } });
		assert.equal(res.status, 404);
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const html = await res.text();
		assert.ok(html.includes('404'));
	}
});

test('https Set-Cookie includes Secure', async () => {
	const { app } = makeApp();
	const res = await app.request('https://example.com/sync', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ops: [], turnstileToken: 'ok' }),
	});
	const set = res.headers.get('set-cookie') ?? '';
	assert.ok(set.includes('Secure'));
});