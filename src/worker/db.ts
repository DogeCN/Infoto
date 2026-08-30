// Db abstraction: one interface, two implementations —
// D1 (Worker, see db-d1.ts) and node:sqlite shim (local, src/local/d1-shim.ts).
// D1-shaped API: prepare(sql).bind(...).all() / .first() / .run(), plus batch().

export interface DbRows<T> {
	results: T[];
}

export interface DbRunResult {
	changes: number;
	last_row_id: number;
}

export interface DbPrepared {
	all<T = Record<string, unknown>>(): Promise<DbRows<T>>;
	first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
	run(): Promise<DbRunResult>;
}

export interface DbBinder extends DbPrepared {
	bind(...values: unknown[]): DbPrepared;
}

export interface Db {
	prepare(sql: string): DbBinder;
	/** Transactional: any failure rolls the whole batch back. */
	batch(stmts: DbPrepared[]): Promise<DbRunResult[]>;
}
