// Turnstile first-entry flow (spec: "身份与 Cookie"):
// explicit rendering (theme dark) → the token rides exactly one first /sync →
// afterwards Turnstile never appears in any flow again.

import { TurnstileRequiredError, postSync } from './api/syncClient';
import type { Op, SyncResponse } from '$shared/types';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Dev fallback site key (Cloudflare's always-passing test key). */
const DEV_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export interface TurnstileFlowDeps {
	/** Injected for unit tests and local wrangler dev. */
	postSyncFn?: typeof postSync;
	/** Token getter; injectable to skip the real widget (E2E / test key). */
	getTokenFn?: (siteKey: string, container: HTMLElement) => Promise<string>;
}

interface TurnstileApi {
	render: (
		el: HTMLElement,
		opts: { sitekey: string; theme?: string; callback?: (token: string) => void; 'error-callback'?: () => void },
	) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId: string) => void;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise((resolve, reject) => {
		const w = window as unknown as { turnstile?: TurnstileApi };
		if (w.turnstile) return resolve(w.turnstile);
		const s = document.createElement('script');
		s.src = TURNSTILE_SCRIPT;
		s.async = true;
		s.onload = () => {
			if (w.turnstile) resolve(w.turnstile);
			else reject(new Error('turnstile api missing'));
		};
		s.onerror = () => reject(new Error('turnstile script load failed'));
		document.head.appendChild(s);
	});
	return scriptPromise;
}

/** Render Turnstile explicitly and wait for the token. */
export async function renderTurnstile(siteKey: string, container: HTMLElement): Promise<string> {
	const ts = await loadTurnstile();
	return new Promise((resolve, reject) => {
		container.innerHTML = '';
		ts.render(container, {
			sitekey: siteKey,
			theme: 'dark',
			callback: (token: string) => resolve(token),
			'image-callback': undefined,
		} as never);
		// error-callback carries no error detail; timeouts are the caller's job
	});
}

export interface IdentityBootstrapResult {
	response: SyncResponse;
	/** true = this was a first entry (identity created with a Turnstile token). */
	firstEntry: boolean;
}

/**
 * First-entry flow = one Turnstile check + two /sync calls (spec wording).
 * With a valid cookie (no 401) the full snapshot returns directly and
 * Turnstile never shows up.
 */
export async function ensureIdentity(ops: Op[] = [], deps: TurnstileFlowDeps = {}): Promise<IdentityBootstrapResult> {
	const sync = deps.postSyncFn ?? postSync;
	try {
		const { response } = await sync({ ops });
		return { response, firstEntry: false };
	} catch (e) {
		if (!(e instanceof TurnstileRequiredError)) throw e;
		const siteKey = e.turnstileSiteKey ?? DEV_SITE_KEY ?? null;
		if (!siteKey) throw new Error('turnstile_required but no site key');
		const container = document.createElement('div');
		container.id = 'infoto-turnstile';
		container.style.position = 'fixed';
		container.style.inset = '0';
		container.style.display = 'grid';
		container.style.placeItems = 'center';
		container.style.zIndex = '9999';
		container.style.background = '#0a0e1a';
		document.body.appendChild(container);
		try {
			const getToken = deps.getTokenFn ?? renderTurnstile;
			const token = await getToken(siteKey, container);
			// the token rides exactly one first /sync
			const { response } = await sync({ turnstileToken: token, ops });
			return { response, firstEntry: true };
		} finally {
			container.remove();
		}
	}
}
