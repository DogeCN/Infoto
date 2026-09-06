import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPLOG_SYNC_THRESHOLD, appendOp, clearOps, countOps, openOplogDb, readOps } from '../../src/core/oplog/store';
import { lookupSha, putSha } from '../../src/core/oplog/cache';

const op = (i: number) => ({ type: 'like' as const, target: i, payload: null });

describe('oplog store (IndexedDB)', () => {
	let db: IDBDatabase;
	beforeEach(async () => {
		// close leftover connections so deleteDatabase is not blocked
		// (in fake-indexeddb an open connection prevents onsuccess forever).
		const dbs = await indexedDB.databases();
		for (const d of dbs) {
			if (d.name === 'infoto') {
				await new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase('infoto');
					req.onsuccess = () => resolve();
					req.onerror = () => resolve();
					req.onblocked = () => resolve();
				});
			}
		}
		db = await openOplogDb();
	});
	afterEach(() => {
		try { db.close(); } catch { /* noop */ }
	});

	it('appends in order and reports counts', async () => {
		expect(await countOps(db)).toBe(0);
		await appendOp(db, op(1));
		await appendOp(db, op(2));
		expect(await countOps(db)).toBe(2);
		const entries = await readOps(db);
		expect(entries.map((e) => (e.op.target as number))).toEqual([1, 2]);
	});

	it('threshold constant is 256', () => {
		expect(OPLOG_SYNC_THRESHOLD).toBe(256);
	});

	it('clearAfter semantics: clearing removes everything', async () => {
		for (let i = 0; i < 5; i++) await appendOp(db, op(i));
		await clearOps(db);
		expect(await countOps(db)).toBe(0);
	});
});

describe('meta cache (sha256 dedupe)', () => {
	let db: IDBDatabase;
	beforeEach(async () => {
		const dbs = await indexedDB.databases();
		for (const d of dbs) {
			if (d.name === 'infoto') {
				await new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase('infoto');
					req.onsuccess = () => resolve();
					req.onerror = () => resolve();
					req.onblocked = () => resolve();
				});
			}
		}
		db = await openOplogDb();
	});
	afterEach(() => {
		try { db.close(); } catch { /* noop */ }
	});

	it('stores and looks up sha entries', async () => {
		await putSha(db, 'abc', 42);
		expect(await lookupSha(db, 'abc')).toMatchObject({ sha256: 'abc', photoId: 42 });
		expect(await lookupSha(db, 'missing')).toBeUndefined();
	});
});