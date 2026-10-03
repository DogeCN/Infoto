// /sync client — the single write entry plus full snapshot. Request/response JSON
// is camelCase throughout; no secondary mapping.

import type { SyncRequest, SyncResponse } from '$shared/types';
import { isLocaleCode } from '$shared/copy';
import { requestJson, type RequestIo } from './request';

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

export interface SyncClientIo extends RequestIo {
  /** Keep the request alive during page unload. Enabled only when the payload fits the 64 KiB browser limit. */
  keepalive?: boolean;
}

export interface SyncCallResult {
  response: SyncResponse;
  /** HTTP status (for 200 assertions). */
  status: number;
}

/** Submit one request; rejected operations remain queued for the next explicit sync trigger. */
export async function postSync(body: SyncRequest, io: SyncClientIo = {}): Promise<SyncCallResult> {
  const { response: res, data } = await requestJson(
    '/sync',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: io.keepalive,
    },
    'sync_timeout',
    io,
  );
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
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
  if (
    obj.ok !== true ||
    !Number.isSafeInteger(obj.selfId) ||
    !Number.isFinite(obj.serverTime) ||
    !Array.isArray(obj.photos) ||
    !Array.isArray(obj.announcements) ||
    !Array.isArray(obj.polls) ||
    !Array.isArray(obj.feedback) ||
    !obj.announcements.every(isLocalized) ||
    !obj.polls.every(isLocalized) ||
    !obj.feedback.every(isLocalized)
  ) {
    throw new Error('invalid_sync_response');
  }
  return { response: obj as unknown as SyncResponse, status: res.status };
}

/** Every content row carries the locale the client filters by; an unlocalized row is a
 *  server bug, not a row to render. */
function isLocalized(row: unknown): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    isLocaleCode((row as Record<string, unknown>)['locale'])
  );
}
