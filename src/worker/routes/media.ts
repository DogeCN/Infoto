// GET /l/:id36 — off-site media proxy: base-36 id → photos row → fetch the stored
// image-host URL → pipe the body straight back with a long immutable cache.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { fromId36, isLoopbackOrigin, isStorableMediaUrl } from '../../shared/media.ts';
import { MEDIA_TYPE } from '../../shared/types.ts';
import { notFoundPage, serverErrorPage } from '../errors.ts';

const MIME_BY_TYPE: Record<number, string> = {
  [MEDIA_TYPE.IMAGE]: 'image/webp',
  [MEDIA_TYPE.ANIMATED]: 'video/webm',
  [MEDIA_TYPE.VIDEO]: 'video/webm',
};

/**
 * Storage/read rule for a media URL: `isStorableMediaUrl` plus the one dev-only exception.
 *
 * `isStorableMediaUrl` is the rule and is not negotiable. The local simulation
 * (`scripts/local-media-host.mjs`) serves plain HTTP on loopback, which that rule rejects
 * by design, so it needs one narrow exception — granted only when the **configured**
 * facade is itself the local simulation, i.e. `MEDIA_HOST_URL` in `.dev.vars` names a
 * loopback origin. A deployed worker's facade is a real HTTPS host (the deploy workflow
 * exits 1 without one), so it never matches and always gets the strict rule.
 *
 * Both the write path (`/sync` upload ops) and the read proxy (`/l/:id36`) must use this,
 * or a locally uploaded photo is stored and then refused, or silently dropped on arrival.
 * Compare parsed origins, never string prefixes: "http://127.0.0.1:8788.evil.example"
 * shares a prefix with the origin but is an unrelated host.
 */
export function isAllowedMediaUrl(env: AppEnv, url: string): boolean {
  if (isStorableMediaUrl(url)) return true;
  // Only a loopback-configured facade unlocks the exception; absent config is a
  // misconfigured deployment and gets no exemption.
  if (!env.mediaHostUrl || !isLoopbackOrigin(env.mediaHostUrl)) return false;
  try {
    return new URL(url).origin === new URL(env.mediaHostUrl).origin;
  } catch {
    return false;
  }
}

export function mediaHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    const id36 = c.req.param('id36') ?? '';
    const id = fromId36(id36);
    if (id === null) return notFoundPage(c.req.raw);

    const row = await env.db.prepare('SELECT url, type FROM photos WHERE id = ?').bind(id).first<{
      url: string;
      type: number;
    }>();
    if (!row || !MIME_BY_TYPE[row.type]) return notFoundPage(c.req.raw);

    let upstream: Response;
    try {
      let url = row.url;
      for (let redirects = 0; ; redirects++) {
        if (!isAllowedMediaUrl(env, url)) return notFoundPage(c.req.raw);
        upstream = await fetch(url, { redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const location = upstream.headers.get('Location');
        await upstream.body?.cancel();
        if (!location || redirects >= 4) return notFoundPage(c.req.raw);
        url = new URL(location, url).href;
      }
    } catch {
      return serverErrorPage(c.req.raw);
    }
    if (!upstream.ok || !upstream.body) return notFoundPage(c.req.raw);

    const headers: Record<string, string> = {
      'Content-Type': MIME_BY_TYPE[row.type],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    const len = upstream.headers.get('Content-Length');
    if (len) headers['Content-Length'] = len;
    return new Response(upstream.body, { status: 200, headers });
  };
}
