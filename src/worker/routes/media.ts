// GET /l/:id36 — off-site media proxy: base-36 id → photos row → fetch the stored
// image-host URL → pipe the body straight back with a long immutable cache.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { fromId36, LOCAL_MEDIA_HOST_URL } from '../../shared/media.ts';
import { MEDIA_TYPE } from '../../shared/types.ts';
import { notFoundPage, serverErrorPage } from '../errors.ts';

export { LOCAL_MEDIA_HOST_URL };

const MIME_BY_TYPE: Record<number, string> = {
  [MEDIA_TYPE.IMAGE]: 'image/webp',
  [MEDIA_TYPE.ANIMATED]: 'video/webm',
  [MEDIA_TYPE.VIDEO]: 'video/webm',
};

/** Host suffixes and names that only ever resolve inside the deployment's own network. */
const PRIVATE_HOST = /^(?:(?:local|internal|localhost)|.*\.(?:local|internal|localhost))$/;

/** IPv4 literal, or null when the host is a name. */
function ipv4(host: string): [number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number) as [number, number, number, number];
  return octets.some((o) => o > 255) ? null : [octets[0], octets[1]];
}

/** Accept HTTPS media URLs while rejecting local hosts and private IP literals. */
export function isStorableMediaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || PRIVATE_HOST.test(host)) return false;
  if (host.startsWith('[')) {
    // Only global-unicast IPv6 literals are accepted; mapped and local addresses are excluded.
    const prefix = Number.parseInt(host.slice(1).split(':')[0], 16);
    return prefix >= 0x2000 && prefix <= 0x3fff;
  }
  const literal = ipv4(host);
  if (!literal) return true;
  const [a, b] = literal;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

/**
 * Storage/read rule for a media URL.
 *
 * `isStorableMediaUrl` is the rule and is not negotiable. The simulated host serves
 * plain HTTP on loopback, which that rule rejects by design, so the local simulation
 * needs one narrow exception — granted only when MEDIA_HOST_URL is unset, i.e. the
 * worker runs as `npm run dev` with no facade configured. A deployed worker always
 * has MEDIA_HOST_URL (the deploy workflow exits1 without it), so a missing value
 * means a misconfigured production worker, and it gets the strict rule rather than
 * a silent downgrade to the permissive local one.
 *
 * Both the write path (`/sync` upload ops) and the read proxy (`/l/:id36`) must use this,
 * or a locally uploaded photo is stored and then refused, or silently dropped on arrival.
 * Compare parsed origins, never string prefixes: "http://127.0.0.1:8788.evil.example"
 * shares a prefix with the origin but is an unrelated host.
 */
export function isAllowedMediaUrl(env: AppEnv, url: string): boolean {
  if (isStorableMediaUrl(url)) return true;
  if (env.mediaHostUrl !== undefined) return false;
  try {
    return new URL(url).origin === LOCAL_MEDIA_HOST_URL;
  } catch {
    return false;
  }
}

export function mediaHandler(env: AppEnv) {
  const acceptable = (url: string): boolean => isAllowedMediaUrl(env, url);

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
        if (!acceptable(url)) return notFoundPage(c.req.raw);
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
