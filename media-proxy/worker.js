/**
 * Standalone image-host facade — upload proxy only.
 *
 * The browser POSTs the artifact here; this worker signs the request with TC_SECRET and
 * forwards it to the upstream image host, then hands back the URL the upstream returned.
 * No KV, no user identity: the facade is a thin, stateless relay, so it can be swapped
 * or replaced without any migration on the album side.
 *
 * Deploy: `wrangler deploy` from this directory. Required: secret TC_SECRET.
 *
 * Routes:
 *   POST /upload   multipart `file` -> 200 { data: <upstream url> }
 *   GET /health    liveness probe
 *
 * CORS is wide open because the facade is a public endpoint by design. Anyone can spend
 * the upstream's quota; rate-limit it at the Cloudflare dashboard (WAF / rate limiting
 * rules) if that matters.
 */

const UPSTREAM_UPLOAD = 'https://tc.0147258.xyz/upload';

/** Response headers worth relaying: rate-limit hints explain a rejection like upstream does. */
const RELAY_HEADERS = ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

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
    headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8' }),
  });

/** Any origin may upload: the facade is a public endpoint and the upstream stays
 *  protected by TC_SECRET. Tighten ALLOWED_ORIGIN if the deployment has a fixed domain. */
const ALLOWED_ORIGIN = '*';

function corsHeaders(extra) {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    ...extra,
  };
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
  if (host === '' || host.startsWith('[')) return false;
  // Reject any purely numeric host: dotted IPv4, decimal (2130706433), or hex (0x7f000001).
  // These bypass the dotted-IPv4 check and may resolve to loopback/internal addresses.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return false;
  }
  if (/^(?:local|internal|localhost)$/.test(host) || /\.(?:local|internal|localhost)$/.test(host)) {
    return false;
  }
  return true;
}

async function handleUpload(request, env) {
  if (!env.TC_SECRET) return json({ error: 'TC_SECRET is not configured' }, 500);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json({ error: 'bad_content_type' }, 400);
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

  // Override content-type: the relayed upstream value may be text/plain etc.,
  // but we always return our own JSON envelope on success.
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isKnownRoute = url.pathname === '/upload' || url.pathname === '/health';
    if (request.method === 'OPTIONS') {
      // Only answer preflight for routes that actually exist; unknown paths get 404.
      if (!isKnownRoute) return json({ error: 'not_found' }, 404);
      return new Response(null, { status: 204, headers: corsHeaders({}) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }
    if (url.pathname === '/upload') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return handleUpload(request, env);
    }
    return json({ error: 'not_found' }, 404);
  },
};
