// Resolve the server session and acquire a Turnstile token when verification is required.

import { TurnstileRequiredError, postSync } from './api/syncClient';
import type { Op, SyncResponse } from '$shared/types';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileFlowDeps {
  /** Injected for unit tests and E2E. */
  postSyncFn?: typeof postSync;
  /** Token acquisition strategy. The default owns an overlay; the application supplies its gallery-mounted widget. */
  requestToken?: (siteKey: string) => Promise<string>;
}

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: string;
  retry?: 'auto' | 'never';
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  'refresh-timeout'?: 'auto' | 'manual' | 'never';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'timeout-callback'?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;
  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const w = window as unknown as { turnstile?: TurnstileApi };
    if (w.turnstile) return resolve(w.turnstile);
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    const timer = setTimeout(() => fail('turnstile script timeout'), TURNSTILE_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
    };
    const fail = (message: string) => {
      cleanup();
      s.remove();
      reject(new Error(message));
    };
    s.onload = () => {
      if (!w.turnstile) return fail('turnstile api missing');
      cleanup();
      resolve(w.turnstile);
    };
    s.onerror = () => fail('turnstile script load failed');
    document.head.appendChild(s);
  });
  scriptPromise = promise;
  // A failed load must not poison the cache: the next attempt retries the script.
  promise.catch(() => {
    if (scriptPromise === promise) scriptPromise = null;
  });
  return promise;
}

/** Active Turnstile widget ID, disposed before its host element is removed. */
let activeWidgetId: string | null = null;

/** Dispose the current widget (idempotent). */
export async function disposeTurnstile(): Promise<void> {
  const id = activeWidgetId;
  activeWidgetId = null;
  if (!id) return;
  try {
    const ts = await loadTurnstile();
    ts.remove(id);
  } catch {
    // No widget to dispose when the script never loaded
  }
}

/** Fallback timeout when Turnstile gives no callback: a stuck widget must not stall first-run onboarding. */
const TURNSTILE_TIMEOUT_MS = 15_000;

/** Delay disposal until the Turnstile iframe's final handshake completes. */
export const TURNSTILE_DISPOSE_DELAY_MS = 800;

/** Render Turnstile explicitly and wait for the token. Rejects on timeout when the
 * widget is stuck (iframe blocked or never loaded) so callers can take the fallback path. */
export async function renderTurnstile(
  siteKey: string,
  container: HTMLElement,
  timeoutMs = TURNSTILE_TIMEOUT_MS,
): Promise<string> {
  const ts = await loadTurnstile();
  // Dispose any leftover widget first, avoiding two renders in the same container
  await disposeTurnstile();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: (v: never) => void, v: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v as never);
    };
    const timer = setTimeout(() => finish(reject, new Error('turnstile_timeout')), timeoutMs);
    container.innerHTML = '';
    activeWidgetId = ts.render(container, {
      sitekey: siteKey,
      theme: 'dark',
      retry: 'never',
      'refresh-expired': 'manual',
      'refresh-timeout': 'manual',
      callback: (token: string) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('turnstile_error')),
      'timeout-callback': () => finish(reject, new Error('turnstile_timeout')),
    });
  });
}

/** Default token acquisition overlay for callers without an existing UI mount point. */
async function overlayRequestToken(siteKey: string): Promise<string> {
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
    return await renderTurnstile(siteKey, container);
  } finally {
    // Hide the overlay at once (no needless black screen), then dispose the widget and drop the node
    container.style.display = 'none';
    setTimeout(() => {
      void disposeTurnstile().finally(() => container.remove());
    }, TURNSTILE_DISPOSE_DELAY_MS);
  }
}

export interface IdentityBootstrapResult {
  response: SyncResponse;
  /** Whether verification created a new identity. */
  firstEntry: boolean;
}

/** Probe the server session, request verification on turnstile_required, and return the authenticated snapshot. */
export async function ensureIdentity(
  ops: Op[] = [],
  deps: TurnstileFlowDeps = {},
): Promise<IdentityBootstrapResult> {
  const sync = deps.postSyncFn ?? postSync;
  let serverSiteKey: string | null;
  try {
    const { response } = await sync({ ops });
    return { response, firstEntry: false };
  } catch (e) {
    if (!(e instanceof TurnstileRequiredError)) throw e;
    serverSiteKey = e.turnstileSiteKey;
  }
  // The server owns the key (it sends it in the 401 body); a missing one is a
  // configuration error and must fail loudly, never be papered over by a build-time key.
  if (!serverSiteKey) throw new Error('turnstile_required but no site key');
  const siteKey = serverSiteKey;
  const requestToken = deps.requestToken ?? overlayRequestToken;
  const token = await requestToken(siteKey);
  // the token rides exactly one first /sync
  const { response } = await sync({ turnstileToken: token, ops });
  return { response, firstEntry: true };
}
