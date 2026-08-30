// Local D1 simulation backed by node:sqlite (DatabaseSync).
// Same Db interface as D1; sync calls wrapped in async, batch() is a real
// BEGIN/COMMIT transaction with full rollback on any failure.

import { DatabaseSync } from 'node:sqlite';
import type { Db, DbPrepared, DbRunResult } from '../worker/db.ts';

interface LocalPrepared extends DbPrepared {
	__sql: string;
	__binds: unknown[];
}

export interface LocalDb extends Db {
	/** Run a multi-statement script (schema.sql) — local bootstrap only. */
	exec(sql: string): void;
	close(): void;
}

/** node:sqlite rejects `undefined` — normalize to null like D1 does. */
const norm = (v: unknown): unknown => (v === undefined ? null : v);

export function openLocalDb(file: string): LocalDb {
	const raw = new DatabaseSync(file);
	raw.exec('PRAGMA journal_mode = WAL;');
	raw.exec('PRAGMA foreign_keys = ON;');

	const wrap = (sql: string, binds: unknown[]): LocalPrepared => {
		const params = binds.map(norm);
		return {
			__sql: sql,
			__binds: params,
			async all<T>() {
				const stmt = raw.prepare(sql);
				const results = stmt.all(...(params as never[])) as T[];
				return { results };
			},
			async first<T>(col?: string) {
				const stmt = raw.prepare(sql);
				const row = stmt.get(...(params as never[])) as Record<string, unknown> | undefined;
				if (row === undefined || row === null) return null;
				if (col) return (col in row ? (row[col] ?? null) : null) as T | null;
				return row as unknown as T;
			},
			async run() {
				const stmt = raw.prepare(sql);
				const r = stmt.run(...(params as never[]));
				return { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) };
			},
		};
	};

	return {
		prepare(sql: string) {
			const unbound = wrap(sql, []);
			return Object.assign(unbound, {
				bind(...values: unknown[]) {
					return wrap(sql, values);
				},
			});
		},
		async batch(stmts: DbPrepared[]) {
			const locals = stmts as LocalPrepared[];
			raw.exec('BEGIN');
			try {
				const out: DbRunResult[] = [];
				for (const s of locals) out.push(await s.run());
				raw.exec('COMMIT');
				return out;
			} catch (err) {
				raw.exec('ROLLBACK');
				throw err;
			}
		},
		exec(sql: string) {
			raw.exec(sql);
		},
		close() {
			raw.close();
		},
	};
}
