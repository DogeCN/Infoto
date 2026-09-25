// Turnstile first-entry flow (spec: "identity and cookies"):
// explicit rendering (theme dark) → the token rides exactly one first /sync →
// afterwards Turnstile never appears in any flow again.

import { TurnstileRequiredError, postSync } from './api/syncClient';
import type { Op, SyncResponse } from '$shared/types';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Dev fallback site key (Cloudflare's always-passing test key). */
const DEV_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export interface TurnstileFlowDeps {
  /** Injected for unit tests and E2E. */
  postSyncFn?: typeof postSync;
  /**
   * Full token-acquisition strategy. The default builds its own full-screen overlay
   * (used when there is no UI context: unit tests, scripted calls); the product UI
   * injects its own implementation that puts the CAPTCHA into an existing empty state.
   */
  requestToken?: (siteKey: string) => Promise<string>;
}

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: string;
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

/**
 * Id of the widget rendered but not yet disposed. Turnstile keeps internal polling
 * timers, so removing the DOM node alone leaves a dangling widget (console spam plus
 * iframe postMessage errors) — call turnstile.remove(id) first.
 */
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

/**
 * Wait window before disposing the widget. Right after the token arrives the Turnstile
 * iframe's final handshake is still in flight, so an immediate remove posts into a
 * torn-down window (target origin mismatch); the DOM node can only go after dispose.
 */
export const TURNSTILE_DISPOSE_DELAY_MS = 800;

/**
 * Render Turnstile explicitly and wait for the token. Rejects on timeout when the
 * widget is stuck (iframe blocked or never loaded) so callers can take the fallback path.
 */
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
      callback: (token: string) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('turnstile_error')),
      'timeout-callback': () => finish(reject, new Error('turnstile_timeout')),
    });
  });
}

/**
 * Default token strategy: a self-built full-screen overlay, used only when there is
 * no UI context (unit tests, scripted calls). `App.svelte` injects its own implementation
 * that puts the CAPTCHA into the waterfall's empty state, avoiding a full-app mask.
 */
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
  /** true = this was a first entry (identity created with a Turnstile token). */
  firstEntry: boolean;
}

/**
 * First entry = one Turnstile check + two /sync calls; with a valid cookie (no 401)
 * the snapshot returns directly. A token is fetched only on 401 turnstile_required —
 * the HttpOnly uuid cookie is unreadable client-side, so /sync must always be probed first.
 */
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
  const siteKey = serverSiteKey ?? DEV_SITE_KEY ?? null;
  if (!siteKey) throw new Error('turnstile_required but no site key');
  const requestToken = deps.requestToken ?? overlayRequestToken;
  const token = await requestToken(siteKey);
  // the token rides exactly one first /sync
  const { response } = await sync({ turnstileToken: token, ops });
  return { response, firstEntry: true };
}
