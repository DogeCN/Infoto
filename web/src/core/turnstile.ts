// Turnstile widget plumbing: script loader and explicit rendering. The sync engine
// decides *when* verification is needed (a `turnstile_required` error frame) and hands
// the public site key to the app, which renders the widget here and calls engine.verify()
// with the token.

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

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
      if (w.turnstile) return resolve(w.turnstile);
      fail('turnstile api missing');
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
export const TURNSTILE_TIMEOUT_MS = 15_000;

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
