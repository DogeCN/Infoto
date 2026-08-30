// POST /upload — streaming proxy to the image host (spec: "图床上传代理").

import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { resolveUser } from '../identity.ts';

const HOST_UPLOAD_URL = 'https://tc.0147258.xyz/upload';

const b64u = (buf: ArrayBuffer | Uint8Array): string => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = (obj: Record<string, unknown>): string => b64u(new TextEncoder().encode(JSON.stringify(obj)));

async function makeTcToken(secret: string): Promise<string> {
	const input = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ timestamp: Date.now() })}`;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
	return `${input}.${b64u(sig)}`;
}

export function uploadHandler(env: AppEnv) {
	return async (c: Context): Promise<Response> => {
		const user = await resolveUser(env.db, c.req.header('cookie'));
		if (!user) return c.json({ ok: false, error: 'unauthorized' }, 401);

		const ct = c.req.header('Content-Type') ?? '';
		if (!ct.toLowerCase().startsWith('multipart/form-data')) {
			return c.json({ ok: false, error: 'bad_content_type' }, 400);
		}

		if (!env.tcSecret) return c.json({ ok: false, error: 'tc_secret_missing' }, 500);

		const init: RequestInit = {
			method: 'POST',
			headers: {
				'X-Auth-Token': await makeTcToken(env.tcSecret),
				'Content-Type': ct,
			},
			body: c.req.raw.body,
		};
		(init as { duplex?: string }).duplex = 'half';

		let upstream: Response;
		try {
			upstream = await fetch(HOST_UPLOAD_URL, init);
		} catch {
			return c.json({ ok: false, error: 'image_host_unreachable' }, 502);
		}
		return new Response(upstream.body, {
			status: upstream.status,
			headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8' },
		});
	};
}
