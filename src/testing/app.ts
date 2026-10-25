// Scaffolding shared by the Worker route tests: schema load, in-memory app factory,
// Turnstile siteverify stub and the /sync request helpers. Every test file installs the
// stub itself (vitest isolates per file).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Op, SyncResponse, Translator } from '../shared/types.ts';
import { createApp } from '../worker/app.ts';
import type { Db, DbPrepared, DbStatement } from '../worker/db.ts';
import { VERIFY_URL } from '../worker/turnstile.ts';
import { openLocalDb, type LocalDb } from './localDb.ts';

const TEST_SECRET = 'test-secret';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');

export type TestApp = ReturnType<typeof createApp>;

/** Answer the siteverify endpoint locally; returns a toggle for failure cases. */
export function stubSiteverify(): (success: boolean) => void {
  const origFetch = globalThis.fetch;
  let success = true;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === VERIFY_URL) return new Response(JSON.stringify({ success }), { status: 200 });
    return origFetch(input as never, init);
  }) as typeof fetch;
  return (v) => {
    success = v;
  };
}

export function makeApp(
  opts: {
    turnstileSecret?: string;
    turnstileSiteKey?: string;
    mediaHostUrl?: string;
    translate?: Translator;
    /** Wrap the database before the app takes it — e.g. to count what a request costs. */
    wrapDb?: (db: LocalDb) => Db;
  } = {},
): {
  db: ReturnType<typeof openLocalDb>;
  app: TestApp;
} {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  const { wrapDb, ...env } = opts;
  const app = createApp({ db: wrapDb ? wrapDb(db) : db, turnstileSecret: TEST_SECRET, ...env });
  return { db, app };
}

export interface DbCallCounts {
  /** Statements that reached the database. */
  queries: number;
  /** `db.batch` calls — one round trip each, however many statements it carries. */
  batches: number;
}

/**
 * A `Db` that counts what reaches the database, so a test can assert a request's cost instead
 * of timing it: a stated number of statements and batches is what D1 latency is a function of,
 * and wall-clock time in a unit test measures the machine, not the query plan.
 */
export function countingDb(
  db: LocalDb,
  counts: DbCallCounts = { queries: 0, batches: 0 },
): { db: Db; counts: DbCallCounts } {
  const counted = (prepared: DbPrepared): DbPrepared => ({
    async all<T>() {
      counts.queries++;
      return prepared.all<T>();
    },
    async first<T>(col?: string) {
      counts.queries++;
      return prepared.first<T>(col);
    },
    async run() {
      counts.queries++;
      return prepared.run();
    },
  });
  return {
    counts,
    db: {
      prepare(sql) {
        const binder = db.prepare(sql);
        return Object.assign(counted(binder), {
          bind: (...values: unknown[]) => counted(binder.bind(...values)),
        });
      },
      batch(stmts: readonly DbStatement[]) {
        counts.batches++;
        return db.batch(stmts);
      },
    },
  };
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
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Identity-creating empty sync; the stub accepts the fake token. */
export function syncNew(app: TestApp, cookie?: string): Promise<Response> {
  return sync(app, { ops: [], turnstileToken: 'ok' }, cookie);
}

export function postOps(app: TestApp, cookie: string, ops: Op[]): Promise<Response> {
  return sync(app, { ops }, cookie);
}

export async function snap(app: TestApp, cookie: string): Promise<SyncResponse> {
  return (await (await postOps(app, cookie, [])).json()) as SyncResponse;
}
