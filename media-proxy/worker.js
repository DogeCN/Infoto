/**
 * Standalone image-host facade.
 *
 * The browser POSTs the artifact here; this worker signs the request with TC_SECRET and
 * forwards it to the upstream image host, then hands back a URL on *this* origin. Storing
 * the facade URL (not the upstream one) is the point: the upstream can be swapped later
 * without rewriting a single `photos.url`.
 *
 * Deploy: `wrangler deploy` from this directory. Required: secret TC_SECRET.
 * Optional: KV namespace binding MEDIA_KV (id -> upstream URL). Without it the upstream
 *           URL is returned directly and reads bypass this worker — fine for a first
 *           deploy, but swapping the upstream later would orphan existing photos.
 * Optional: secret TURNSTILE_SECRET_KEY. When set, every upload must carry a Turnstile
 *           token in the `X-Turnstile-Token` header, which keeps a stranger from turning
 *           this into a free anonymous image host.
 *
 * Routes:
 *   POST   /upload   multipart `file` -> 200 { data: <facade url> }
 *   GET    /m/:id    streams the artifact back with a long immutable cache
 *   DELETE /m/:id    drops the mapping (tidy-up only; nothing enforces it)
 *   GET    /health   liveness probe
 */

const UPSTREAM_UPLOAD = 'https://tc.0147258.xyz/upload';

/** Response headers worth relaying: rate-limit hints explain a rejection like upstream does. */
const RELAY_HEADERS = ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Media type by file extension, used when relaying a stored artifact. */
const MIME_BY_EXT = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

/** Opaque, URL-safe id. Not a secret — it only names a KV entry. */
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** base64url of a byte buffer, sliced so a large buffer cannot overflow the argument limit. */
function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

/** HS256 JWT over `{alg,typ}` and `{timestamp}`, signed with the shared secret. */
async function makeTcToken(secret) {
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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Any origin may upload: the facade is a public endpoint by design and the upstream stays
 * protected by TC_SECRET. CORS is therefore wide open — tighten ALLOWED_ORIGIN if the
 * deployment has a fixed front-end domain.
 */
const ALLOWED_ORIGIN = '*';

function corsHeaders(extra) {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-turnstile-token',
    'access-control-max-age': '86400',
    ...extra,
  };
}

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(TURNSTILE_VERIFY, { method: 'POST', body: form });
    const body = await res.json();
    return body.success === true;
  } catch {
    return false;
  }
}

/** Accept only plain public HTTPS URLs coming back from the upstream. */
function isPublicHttps(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (/^(?:local|internal|localhost)$/.test(host) || /\.(?:local|internal|localhost)$/.test(host)) {
    return false;
  }
  return true;
}

const facadeBase = (request) => new URL(request.url).origin;

async function handleUpload(request, env) {
  if (!env.TC_SECRET) return json({ error: 'TC_SECRET is not configured' }, 500);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json({ error: 'bad_content_type' }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = request.headers.get('X-Turnstile-Token') ?? '';
    if (!token) return json({ error: 'turnstile_required' }, 401);
    const passed = await verifyTurnstile(
      token,
      env.TURNSTILE_SECRET_KEY,
      request.headers.get('CF-Connecting-IP'),
    );
    if (!passed) return json({ error: 'turnstile_failed' }, 401);
  }

  const init = {
    method: 'POST',
    headers: { 'X-Auth-Token': await makeTcToken(env.TC_SECRET), 'Content-Type': contentType },
    body: request.body,
    // Streaming a request body requires half-duplex on the runtime.
    duplex: 'half',
  };

  let upstream;
  try {
    upstream = await fetch(UPSTREAM_UPLOAD, init);
  } catch {
    return json({ error: 'image_host_unreachable' }, 502);
  }

  // Relay the status and the reason headers; the body is the upstream JSON either way.
  const headers = corsHeaders({});
  for (const name of RELAY_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const text = await upstream.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(text, { status: 502, headers });
  }
  const data = parsed?.data;
  if (typeof data !== 'string' || !data || !isPublicHttps(data)) {
    // An upstream URL we refuse to store must not reach the client as a success.
    return json({ error: 'bad_upstream_url' }, 502);
  }

  // Without KV there is nowhere to remember the mapping, so the caller gets the upstream
  // URL and reads go straight to the image host.
  if (!env.MEDIA_KV) {
    return new Response(JSON.stringify({ data }), { status: 200, headers });
  }

  const id = newId();
  await env.MEDIA_KV.put(id, data);
  const facadeUrl = `${facadeBase(request)}/m/${id}`;
  return new Response(JSON.stringify({ data: facadeUrl }), { status: 200, headers });
}

async function handleRead(request, env, id) {
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'bad_id' }, 400);
  if (!env.MEDIA_KV) return json({ error: 'no_kv_binding' }, 500);

  const target = await env.MEDIA_KV.get(id);
  if (typeof target !== 'string' || !isPublicHttps(target))
    return json({ error: 'not_found' }, 404);

  let upstream;
  try {
    upstream = await fetch(target, { redirect: 'follow' });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502);
  }
  if (!upstream.ok || !upstream.body) return json({ error: 'not_found' }, 404);

  const ext = (new URL(target).pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  return new Response(upstream.body, {
    status: 200,
    headers: corsHeaders({
      'content-type':
        upstream.headers.get('Content-Type') ?? MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      // The bytes behind an id never change, so let the edge hold them.
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders({}) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, kv: Boolean(env.MEDIA_KV) });
    }
    if (url.pathname === '/upload') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return handleUpload(request, env);
    }
    const read = /^\/m\/([^/]+)$/.exec(url.pathname);
    if (read) {
      if (request.method === 'DELETE') {
        if (env.MEDIA_KV) await env.MEDIA_KV.delete(read[1]);
        return new Response(null, { status: 204, headers: corsHeaders({}) });
      }
      if (request.method === 'GET') return handleRead(request, env, read[1]);
      return json({ error: 'method_not_allowed' }, 405);
    }
    return json({ error: 'not_found' }, 404);
  },
};
