// id36 — autoincrement id <-> base-36 string (0-9a-z), pure functions.
// External media id representation: 7 -> "7", 35 -> "z", 36 -> "10".

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

/** Local simulated image host (scripts/local-media-host.mjs), used by `npm run dev`.
 *  A deployment must set MEDIA_HOST_URL to the standalone facade (ADR 0009); the deploy
 *  workflow refuses to run without it, so this default is never the production
 *  configuration. The Worker and the browser client both fall back to it. */
export const LOCAL_MEDIA_HOST_URL = 'http://127.0.0.1:8788';
