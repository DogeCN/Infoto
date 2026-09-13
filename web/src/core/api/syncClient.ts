// /sync client — the single write entry + full snapshot (spec: "/sync 协议").
// Request/response JSON is camelCase throughout; no secondary mapping.

import type { Op, SyncRequest, SyncResponse } from '$shared/types';

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
}

export interface SyncCallResult {
	response: SyncResponse;
	/** HTTP status (for 200 assertions). */
	status: number;
}

/** 429 backoff attempts (Cloudflare edge rate limit bursts); 0-indexed delays. */
export const RATE_LIMIT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

/**
 * POST {origin}/sync. Contract edges:
 * - request body never carries a uuid field (the server distrusts body identity);
 * - 401 turnstile_required → read body turnstileSiteKey, throw TurnstileRequiredError;
 * - 401 turnstile_failed → throw TurnstileFailedError;
 * - 429 → brief backoff retry (edge rate limit), then surface as any other error;
 * - any other non-ok response → throw Error (with the error field).
 */
export async function postSync(
	body: SyncRequest,
	io: SyncClientIo = {},
): Promise<SyncCallResult> {
	const fetchFn = io.fetchFn ?? fetch;
	const origin = io.origin ?? window.location.origin;
	let res: Response;
	for (let attempt = 0; ; attempt++) {
		res = await fetchFn(`${origin}/sync`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'include',
		});
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

/** Convenience wrapper: sync with no ops (site open / manual sync). */
export function syncWithOps(ops: Op[], io?: SyncClientIo): Promise<SyncCallResult> {
	return postSync({ ops }, io);
}
