// GET /l/:id36 — off-site media proxy (spec: "媒体代理（/l/:id36）").
// Base-36 id -> photos row -> fetch host URL -> pipe the body straight back.
// The image-host URL never appears in any response; long immutable caching.

import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { notFoundPage, serverErrorPage } from '../errors.ts';

export function mediaHandler(env: AppEnv) {
	return async (c: Context): Promise<Response> => {
		const id36 = c.req.param('id36') ?? '';
		if (!/^[0-9a-z]+$/.test(id36)) return notFoundPage();
		const id = parseInt(id36, 36);
		if (!Number.isSafeInteger(id)) return notFoundPage();

		const row = await env.db.prepare('SELECT id, url, type FROM photos WHERE id = ?').bind(id).first<{
			id: number;
			url: string;
			type: number;
		}>();
		if (!row) return notFoundPage();

		let upstream: Response;
		try {
			upstream = await fetch(row.url);
		} catch {
			return serverErrorPage();
		}
		if (!upstream.ok || !upstream.body) return notFoundPage();

		const headers: Record<string, string> = {
			'Content-Type': upstream.headers.get('Content-Type') ?? (row.type === 0 ? 'image/webp' : 'video/webm'),
			'Cache-Control': 'public, max-age=31536000, immutable',
		};
		const len = upstream.headers.get('Content-Length');
		if (len) headers['Content-Length'] = len;
		return new Response(upstream.body, { status: 200, headers });
	};
}
