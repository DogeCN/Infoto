// GET /l/:id36 — off-site media proxy: base-36 id → photos row → fetch the stored
// image-host URL → pipe the body straight back with a long immutable cache.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { MEDIA_TYPE } from '../../shared/types.ts';
import { notFoundPage, serverErrorPage } from '../errors.ts';

const MIME_BY_TYPE: Record<number, string> = {
  [MEDIA_TYPE.IMAGE]: 'image/webp',
  [MEDIA_TYPE.ANIMATED]: 'video/webm',
  [MEDIA_TYPE.VIDEO]: 'video/webm',
};

/** Host suffixes and names that only ever resolve inside the deployment's own network. */
const PRIVATE_HOST = /^(?:localhost|.*\.(?:local|internal|localhost))$/;

/** IPv4 literal, or null when the host is a name. */
function ipv4(host: string): [number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number) as [number, number, number, number];
  return octets.some((o) => o > 255) ? null : [octets[0], octets[1]];
}

/**
 * Whether `url` may be stored as a photo's source. Only https is accepted, and hosts
 * that resolve to the deployment's own network are refused, so a stored URL can never
 * turn the proxy into a request against internal infrastructure.
 */
export function isStorableMediaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === '' || host === '::1' || PRIVATE_HOST.test(host)) return false;
  const literal = ipv4(host);
  if (!literal) return true;
  const [a, b] = literal;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

export function mediaHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    const id36 = c.req.param('id36') ?? '';
    if (!/^[0-9a-z]+$/.test(id36)) return notFoundPage();
    const id = parseInt(id36, 36);
    if (!Number.isSafeInteger(id)) return notFoundPage();

    const row = await env.db.prepare('SELECT url, type FROM photos WHERE id = ?').bind(id).first<{
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
      'Content-Type':
        upstream.headers.get('Content-Type') ??
        MIME_BY_TYPE[row.type] ??
        'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    const len = upstream.headers.get('Content-Length');
    if (len) headers['Content-Length'] = len;
    return new Response(upstream.body, { status: 200, headers });
  };
}
