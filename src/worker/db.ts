// Database access contract: `prepare(sql).bind(…).all() / .first() / .run()` plus a
// transactional `batch()`. `db-d1.ts` implements it over D1; the node:sqlite adapter in
// `src/testing/localDb.ts` implements it for unit tests.

/** One statement queued for `Db.batch`. */
export interface DbStatement {
  /** A single statement, without the trailing semicolon. */
  readonly sql: string;
  /** Positional bind values. */
  readonly binds: readonly unknown[];
}

export interface DbRows<T> {
  results: T[];
}

export interface DbRunResult {
  changes: number;
  last_row_id: number;
}

export interface DbPrepared {
  all<T = Record<string, unknown>>(): Promise<DbRows<T>>;
  /** One row, or the value of one column of it, or null when there is no row. */
  first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
  run(): Promise<DbRunResult>;
}

export interface DbBinder extends DbPrepared {
  bind(...values: unknown[]): DbPrepared;
}

export interface Db {
  prepare(sql: string): DbBinder;
  /** Runs the statements in one transaction: any failure rolls the whole batch back. */
  batch(stmts: readonly DbStatement[]): Promise<DbRunResult[]>;
}
