// Media identifiers and origin rules, shared by both runtimes.
// - id36: autoincrement id <-> base-36 string (0-9a-z). External form: 7 -> "7".
// - the extension `photos.type` implies.
// - the host policy for a stored media URL, and the loopback exception's own predicate.

/** Numeric id -> base-36 string. Throws on negative / non-integer input. */
export function toId36(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`invalid id: ${id}`);
  return id.toString(36);
}

/** Base-36 string -> numeric id, or null when malformed. */
export function fromId36(s: string): number | null {
  if (!/^[0-9a-z]+$/.test(s)) return null;
  const n = parseInt(s, 36);
  return Number.isSafeInteger(n) ? n : null;
}

/** Short media URL for off-site scenarios: `{origin}/l/{id36}`. */
export function proxyUrl(origin: string, id: number): string {
  return `${origin}/l/${toId36(id)}`;
}

/** File extension implied by photos.type (only webp / webm exist). */
export function extOfType(type: number): 'webp' | 'webm' {
  return type === 0 ? 'webp' : 'webm';
}

/** Loopback origins a dev-only media host may serve on: `http://127.0.0.1` / `[::1]`,
 *  any port. Used to recognise the local simulation (`scripts/local-media-host.mjs`)
 *  without hardcoding its port, which lives in `.dev.vars` as `MEDIA_HOST_URL`. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === '[::1]' || host === 'localhost';
  } catch {
    return false;
  }
}

/** Host suffixes and names that only ever resolve inside the deployment's own network. */
const PRIVATE_HOST = /^(?:(?:local|internal|localhost)|.*\.(?:local|internal|localhost))$/;

/** IPv4 literal, or null when the host is a name. */
function ipv4(host: string): [number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number) as [number, number, number, number];
  return octets.some((o) => o > 255) ? null : [octets[0], octets[1]];
}

/**
 * A stored media URL: HTTPS, no credentials, and a host a visitor's browser can reach from
 * the public internet. The read proxy fetches it from the edge with no credentials, so a
 * private literal is an SSRF vector rather than a policy preference.
 *
 * The local simulation serves plain-HTTP loopback and is rejected here by design; the worker
 * unlocks it through `isAllowedMediaUrl` only while `MEDIA_HOST_URL` itself names a loopback
 * origin (see `isLoopbackOrigin`).
 */
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
