import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.ts';
import { openLocalDb } from '../../local/d1-shim.ts';
import type { SyncResponse } from '../../shared/types.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function makeApp() {
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const app = createApp({ db });
	return { db, app };
}

function cookieFrom(res: Response): string {
	const raw = res.headers.get('set-cookie') ?? '';
	const m = raw.match(/infoto_id=([^;]+)/);
	assert.ok(m, 'Set-Cookie infoto_id');
	return `infoto_id=${m[1]}`;
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

test('no cookie, no secret: warn-allow, selfId 0, camelCase, no users, empty feedback', async () => {
	const warns: string[] = [];
	const orig = console.warn;
	console.warn = (...args: unknown[]) => {
		warns.push(String(args[0]));
	};
	try {
		const { app } = makeApp();
		const res = await sync(app, { ops: [] });
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
		assert.ok(warns.some((w) => w.includes('[turnstile] secret 未配置，放行')));
		const set = res.headers.get('set-cookie') ?? '';
		assert.ok(set.includes('HttpOnly'));
		assert.ok(set.includes('SameSite=Lax'));
		assert.ok(!set.includes('Secure'));
	} finally {
		console.warn = orig;
	}
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
	const orig = globalThis.fetch;
	globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
	try {
		const db = openLocalDb(':memory:');
		db.exec(schema);
		const app = createApp({ db, turnstileSecret: 'sk' });
		const res = await sync(app, { turnstileToken: 'bad', ops: [] });
		assert.equal(res.status, 401);
		assert.deepEqual(await res.json(), { ok: false, error: 'turnstile_failed' });
	} finally {
		globalThis.fetch = orig;
	}
});

test('upload, sha collision silent, missing fields silent, created_at/uploader ignored', async () => {
	const { app } = makeApp();
	const first = await sync(app, { ops: [] });
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
	const cookie = cookieFrom(await sync(app, { ops: [] }));
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
	const rootCookie = cookieFrom(await sync(app, { ops: [] }));
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
	const guest = await sync(app, { ops: [] });
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
	const asRoot = (await (await sync(app, { ops: [] }, rootCookie)).json()) as SyncResponse;
	assert.equal(asRoot.feedback.length, 1);
	assert.equal(asRoot.feedback[0]!.userId, 1);
	assert.equal(asRoot.feedback[0]!.contentMd, 'hello');
});

test('announcements embed reactions; missing update silent; delete cascades; reorder strips NaN', async () => {
	const { app } = makeApp();
	const cookie = cookieFrom(await sync(app, { ops: [] }));
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

test('upload without multipart → 400; no cookie → 401', async () => {
	const { app } = makeApp();
	const noAuth = await app.request('http://localhost/upload', { method: 'POST', body: 'x' });
	assert.equal(noAuth.status, 401);
	const cookie = cookieFrom(await sync(app, { ops: [] }));
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
	cookieFrom(await sync(app, { ops: [] }));
	const guest = cookieFrom(await sync(app, { ops: [] }));
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
		body: JSON.stringify({ ops: [] }),
	});
	const set = res.headers.get('set-cookie') ?? '';
	assert.ok(set.includes('Secure'));
});
