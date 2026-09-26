// /sync client — the single write entry plus full snapshot. Request/response JSON
// is camelCase throughout; no secondary mapping.

import type { SyncRequest, SyncResponse } from '$shared/types';

/** Thrown on 401 turnstile_required; carries the public site key from the body. */
export class TurnstileRequiredError extends Error {
  readonly turnstileSiteKey: string | null;
  constructor(turnstileSiteKey: string | null) {
    super('turnstile_required');
    this.name = 'TurnstileRequiredError';
    this.turnstileSiteKey = turnstileSiteKey;
  }
}

/** 401 turnstile_failed: token rejected; the widget must be rendered again. */
export class TurnstileFailedError extends Error {
  constructor() {
    super('turnstile_failed');
    this.name = 'TurnstileFailedError';
  }
}

export interface SyncClientIo {
  fetchFn?: typeof fetch;
  origin?: string;
  /** Per-attempt timeout override (tests inject small values). */
  timeoutMs?: number;
  /** keepalive: a plain fetch is cancelled by the browser when the page is hidden
   * or closed; a keepalive request survives unload with its body. Keepalive bodies
   * are capped at 64KB — the caller must verify the payload fits, or leave this off. */
  keepalive?: boolean;
}

export interface SyncCallResult {
  response: SyncResponse;
  /** HTTP status (for 200 assertions). */
  status: number;
}

/** 429 backoff attempts (Cloudflare edge rate limit bursts); 0-indexed delays. */
export const RATE_LIMIT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/** Hard ceiling on one /sync attempt: a dead backend holds the socket open instead
 * of refusing it, so a fetch without a timeout never settles (`engine.syncing`
 * stays true and every write looks frozen). Mirrors `UPLOAD_TIMEOUT_MS`. */
export const SYNC_TIMEOUT_MS = 15_000;

/** POST {origin}/sync. The request body never carries a uuid field (the server distrusts body identity); `keepalive` passes straight through to fetch, set by the engine only when the document is hidden and the whole body fits the keepalive cap.
 * 401 turnstile_required → read body turnstileSiteKey and throw TurnstileRequiredError; 401 turnstile_failed → throw TurnstileFailedError; 429 → brief backoff retry (edge rate limit), then surface like any other error.
 * Any other non-ok response → throw Error carrying the error field; an attempt exceeding `timeoutMs` → abort and throw Error('sync_timeout'). */
export async function postSync(body: SyncRequest, io: SyncClientIo = {}): Promise<SyncCallResult> {
  const fetchFn = io.fetchFn ?? fetch;
  const origin = io.origin ?? window.location.origin;
  const timeoutMs = io.timeoutMs ?? SYNC_TIMEOUT_MS;
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetchFn(`${origin}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
        signal: ctrl.signal,
        keepalive: io.keepalive,
      });
    } catch (e) {
      // Separate timeout from network failure: the stable marker lets the UI show "backend not responding"
      if ((e as Error)?.name === 'AbortError') throw new Error('sync_timeout', { cause: e });
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (res.status !== 429 || attempt >= RATE_LIMIT_DELAYS_MS.length) break;
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAYS_MS[attempt]));
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body falls through to the generic error path
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  if (res.status === 401 && obj['error'] === 'turnstile_required') {
    throw new TurnstileRequiredError((obj['turnstileSiteKey'] as string | null) ?? null);
  }
  if (res.status === 401 && obj['error'] === 'turnstile_failed') {
    throw new TurnstileFailedError();
  }
  if (!res.ok) {
    const err = typeof obj['error'] === 'string' ? obj['error'] : `HTTP ${res.status}`;
    throw new Error(err);
  }
  return { response: obj as unknown as SyncResponse, status: res.status };
}
