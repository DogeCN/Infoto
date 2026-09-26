// Db implementation over D1 (Worker runtime).

import type { Db, DbPrepared } from './db.ts';

export function d1Db(d1: D1Database): Db {
  const wrap = (ps: D1PreparedStatement): DbPrepared => ({
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
    prepare(sql) {
      return Object.assign(wrap(d1.prepare(sql)), {
        bind(...values: unknown[]) {
          return wrap(d1.prepare(sql).bind(...(values as never[])));
        },
      });
    },
    async batch(stmts) {
      const rs = await d1.batch(stmts.map((s) => d1.prepare(s.sql).bind(...(s.binds as never[]))));
      return rs.map((r) => ({ changes: r.meta.changes, last_row_id: r.meta.last_row_id }));
    },
  };
}
