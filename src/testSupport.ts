// Shared scaffolding for the Worker route tests: schema load, in-memory app
// factory, Turnstile siteverify stub and the /sync request helpers every suite
// needs. Each test file installs the stub itself (vitest isolates per file).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Op, SyncResponse } from './shared/types.ts';
import { createApp } from './worker/app.ts';
import { openLocalDb } from './d1-shim.ts';

export const TEST_SECRET = 'test-secret';

export const schema = readFileSync(path.join(import.meta.dirname, '..', 'schema.sql'), 'utf8');

export type TestApp = ReturnType<typeof createApp>;

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Answer the siteverify endpoint locally; returns a toggle for failure cases. */
export function stubSiteverify(): (success: boolean) => void {
  const origFetch = globalThis.fetch;
  let success = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (url === VERIFY_URL) return new Response(JSON.stringify({ success }), { status: 200 });
    return origFetch(input as never, init);
  }) as typeof fetch;
  return (v: boolean) => {
    success = v;
  };
}

export function makeApp(opts: { turnstileSecret?: string; turnstileSiteKey?: string } = {}): {
  db: ReturnType<typeof openLocalDb>;
  app: TestApp;
} {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  const app = createApp({ db, turnstileSecret: TEST_SECRET, ...opts });
  return { db, app };
}

export function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = raw.match(/uuid=([^;]+)/);
  assert.ok(m, 'Set-Cookie uuid');
  return `uuid=${m[1]}`;
}

export async function sync(app: TestApp, body: unknown, cookie?: string): Promise<Response> {
  return app.request('http://localhost/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Identity-creating empty sync (the stub verifies the fake token). */
export function syncNew(app: TestApp, cookie?: string): Promise<Response> {
  return sync(app, { ops: [], turnstileToken: 'ok' }, cookie);
}

export function postOps(app: TestApp, cookie: string, ops: Op[]): Promise<Response> {
  return sync(app, { ops }, cookie);
}

export async function snap(app: TestApp, cookie: string): Promise<SyncResponse> {
  return (await (await postOps(app, cookie, [])).json()) as SyncResponse;
}
