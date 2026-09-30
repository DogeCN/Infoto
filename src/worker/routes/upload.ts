// POST /upload — authenticated streaming proxy to the image host: checks the session
// cookie, signs a short-lived token for the upstream, and pipes the multipart body
// through unchanged.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { resolveUser } from '../identity.ts';

/** Local simulated image host (scripts/local-media-host.mjs), so a dev upload never
 *  reaches the production host. Deployments set MEDIA_HOST_URL to the real endpoint. */
const LOCAL_MEDIA_ORIGIN = 'http://127.0.0.1:8788';

/** Origin the media proxy may additionally trust for stored URLs, or null when a real
 *  image host is configured (production stores only public HTTPS URLs). */
export function localMediaOrigin(env: AppEnv): string | null {
  if (env.mediaHostUrl) return null;
  return LOCAL_MEDIA_ORIGIN;
}

const hostUploadUrl = (env: AppEnv): string =>
  env.mediaHostUrl ? `${env.mediaHostUrl}/upload` : `${LOCAL_MEDIA_ORIGIN}/upload`;

/** Upstream headers worth passing back: the client parses the JSON body, and rate-limit
 *  headers explain a rejection the same way the image host does. */
const FORWARDED_HEADERS = [
  'content-type',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
];

/** base64url of a byte buffer, encoded in slices so a large buffer cannot overflow the
 *  argument limit of `String.fromCharCode`. */
function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const enc = (obj: Record<string, unknown>): string =>
  b64u(new TextEncoder().encode(JSON.stringify(obj)));

/** HS256 JWT over `{alg,typ}` and `{timestamp}`, signed with the shared secret. */
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

    const upstreamUrl = hostUploadUrl(env);
    // The real host authenticates by token; the local simulation ignores it. Signing only
    // when a secret exists keeps `npm run dev` working on a fresh clone (no TC_SECRET)
    // without ever sending an unsigned request to a real host.
    const reqHeaders = new Headers({ 'Content-Type': ct });
    if (env.tcSecret) reqHeaders.set('X-Auth-Token', await makeTcToken(env.tcSecret));

    const init: RequestInit = { method: 'POST', headers: reqHeaders, body: c.req.raw.body };
    // Streaming a request body requires half-duplex on the runtime.
    (init as { duplex?: string }).duplex = 'half';

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, init);
    } catch {
      return c.json({ ok: false, error: 'image_host_unreachable' }, 502);
    }

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  };
}
