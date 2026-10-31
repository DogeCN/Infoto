// Scaffolding shared by the Worker route tests: schema load, in-memory app factory,
// Turnstile siteverify stub and a request-costing database wrapper. Every test file
// installs the stub itself (vitest isolates per file).
//
// Identity and album mutations are WebSocket ops via the Durable Object now, so there is
// no HTTP /sync to drive in tests — fixtures that need rows insert them directly.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Translator } from '../shared/types.ts';
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
  /** The most parameters bound by any single statement, against D1's 100-per-query cap. */
  maxBinds: number;
}

/**
 * A `Db` that counts what reaches the database, so a test can assert a request's cost instead
 * of timing it: a stated number of statements and batches is what D1 latency is a function of,
 * and wall-clock time in a unit test measures the machine, not the query plan.
 */
export function countingDb(
  db: LocalDb,
  counts: DbCallCounts = { queries: 0, batches: 0, maxBinds: 0 },
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
          bind: (...values: unknown[]) => {
            counts.maxBinds = Math.max(counts.maxBinds, values.length);
            return counted(binder.bind(...values));
          },
        });
      },
      batch(stmts: readonly DbStatement[]) {
        counts.batches++;
        for (const statement of stmts) {
          counts.maxBinds = Math.max(counts.maxBinds, statement.binds.length);
        }
        return db.batch(stmts);
      },
    },
  };
}
