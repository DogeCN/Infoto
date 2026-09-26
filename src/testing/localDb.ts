// Db implementation over node:sqlite, for local runs and unit tests. `batch` is a real
// BEGIN/COMMIT transaction with full rollback on any failure.
//
// node:sqlite is loaded through createRequire: Vite's SSR transform strips the `node:`
// prefix from a static import, which breaks the module under vitest.

import { createRequire } from 'node:module';
import type { Db, DbPrepared, DbRunResult, DbStatement } from '../worker/db.ts';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export interface LocalDb extends Db {
  /** Run a multi-statement script (schema.sql). */
  exec(sql: string): void;
  close(): void;
}

/** node:sqlite rejects `undefined`; D1 stores it as null. */
const norm = (v: unknown): unknown => (v === undefined ? null : v);

export function openLocalDb(file: string): LocalDb {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');

  const wrap = (sql: string, binds: readonly unknown[]): DbPrepared => {
    const params = binds.map(norm);
    return {
      async all<T>() {
        return { results: raw.prepare(sql).all(...(params as never[])) as T[] };
      },
      async first<T>(col?: string) {
        const row = raw.prepare(sql).get(...(params as never[])) as
          Record<string, unknown> | undefined;
        if (row === undefined || row === null) return null;
        if (!col) return row as unknown as T;
        return (col in row ? (row[col] ?? null) : null) as T | null;
      },
      async run() {
        const r = raw.prepare(sql).run(...(params as never[]));
        return { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) };
      },
    };
  };

  return {
    prepare(sql) {
      return Object.assign(wrap(sql, []), {
        bind(...values: unknown[]) {
          return wrap(sql, values);
        },
      });
    },
    async batch(stmts: readonly DbStatement[]) {
      raw.exec('BEGIN');
      try {
        const out: DbRunResult[] = [];
        for (const s of stmts) {
          const r = raw.prepare(s.sql).run(...s.binds.map(norm).map((v) => v as never));
          out.push({ changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) });
        }
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    exec(sql) {
      raw.exec(sql);
    },
    close() {
      raw.close();
    },
  };
}
