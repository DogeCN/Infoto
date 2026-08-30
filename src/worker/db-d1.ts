// D1 implementation of the Db interface (Worker runtime only).
// Thin pass-through keeping D1 semantics intact.

import type { Db, DbPrepared, DbRunResult } from './db.ts';

export function d1Db(d1: D1Database): Db {
	const wrap = (ps: D1PreparedStatement): DbPrepared & { __raw: D1PreparedStatement } => ({
		__raw: ps,
		async all<T>() {
			const r = await ps.all<T>();
			return { results: r.results };
		},
		async first<T>(col?: string) {
			return (await ps.first<T>(col as never)) ?? null;
		},
		async run() {
			const r = await ps.run();
			return { changes: r.meta.changes, last_row_id: r.meta.last_row_id };
		},
	});
	return {
		prepare(sql: string) {
			const unbound = wrap(d1.prepare(sql));
			return Object.assign(unbound, {
				bind(...values: unknown[]) {
					return wrap(d1.prepare(sql).bind(...(values as never[])));
				},
			});
		},
		async batch(stmts: DbPrepared[]) {
			const raws = (stmts as { __raw?: D1PreparedStatement }[]).map((s) => s.__raw as D1PreparedStatement);
			const rs = await d1.batch(raws);
			return rs.map((r) => ({ changes: r.meta.changes, last_row_id: r.meta.last_row_id }));
		},
	};
}
