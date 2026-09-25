// Sync triggers (spec): site open / pagehide / visibilitychange→hidden /
// op-log at 256 entries / manual.
// The pagehide handler is registered separately from visibilitychange→hidden
// (the contract's token-audit clause applies here too).

import type { Op, SyncResponse } from '$shared/types';
import { postSync } from '../api/syncClient';
import { remapOpTarget } from '../ops';
import { rebuildCache } from '../oplog/cache';
import { OPLOG_SYNC_THRESHOLD, appendOp, clearOps, countOps, openOplogDb, readOps } from '../oplog/store';

/** Browser hard limit for a keepalive request body. */
export const KEEPALIVE_BODY_LIMIT = 65_536;

/**
 * Longest op prefix whose serialized SyncRequest fits the keepalive byte
 * budget. Measurement is exact: TextEncoder over the already-serialized JSON
 * (the `{"ops":[…]}` wrapper and commas are accounted for). Returns null when
 * even the first op alone busts the budget (only possible via a giant
 * ann_create body — abnormal; caller warns and keeps the op for next time).
 */
export function keepalivePrefix(ops: Op[], budget: number = KEEPALIVE_BODY_LIMIT): { ops: Op[]; body: string } | null {
	const enc = new TextEncoder();
	const wrapper = enc.encode('{"ops":[]}').length;
	let bytes = wrapper;
	const picked: Op[] = [];
	const parts: string[] = [];
	for (const op of ops) {
		const s = JSON.stringify(op);
		const n = enc.encode(s).length + (picked.length > 0 ? 1 : 0); // comma
		if (bytes + n > budget) {
			if (picked.length === 0) return null; // first op alone is oversize
			break;
		}
		bytes += n;
		picked.push(op);
		parts.push(s);
	}
	return { ops: picked, body: `{"ops":[${parts.join(',')}]}` };
}

export interface EngineIo {
	db?: IDBDatabase;
	fetchFn?: typeof fetch;
	postSyncFn?: typeof postSync;
	/** Response sink (store write). */
	onSyncResponse?: (
		r: SyncResponse,
		context: SyncSnapshotContext,
	) => Map<number, number> | void;
	onError?: (phase: 'submit' | 'pagehide', e: unknown) => void;
}

export interface SyncSnapshotContext {
	attempt: number;
}

export type SyncAttemptResult =
	| { ok: true; confirmedThroughVersion: number }
	| { ok: false; error: unknown; confirmedThroughVersion: number };

export interface EngineState {
	/** true = a sync is in flight (ops keep accumulating; operations are never blocked). */
	syncing: boolean;
	/** Pending op count (snapshot, for harness display). */
	pending: number;
}

const globalScope = globalThis as unknown as { __infotoEngine?: SyncEngine };

/** Sync engine — singleton. */
export class SyncEngine {
	private db: IDBDatabase | null = null;
	private io: EngineIo;
	private listeners = new Set<(s: EngineState) => void>();
	private syncing = false;
	private pending = 0;
	private attempt = 0;
	private opVersion = 0;
	private activeSync: Promise<SyncAttemptResult> | null = null;
	private criticalFlush:
		| { throughVersion: number; promise: Promise<SyncAttemptResult> }
		| null = null;
	readonly state: EngineState = { syncing: false, pending: 0 };

	constructor(io: EngineIo = {}) {
		this.io = io;
		this.db = io.db ?? null;
	}

	private emit(): void {
		this.state.syncing = this.syncing;
		this.state.pending = this.pending;
		for (const l of this.listeners) l({ ...this.state });
	}

	onState(l: (s: EngineState) => void): () => void {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	}

	get currentSyncAttempt(): number {
		return this.attempt;
	}

	async init(): Promise<void> {
		if (!this.db) this.db = await openOplogDb();
		this.pending = await countOps(this.db);
		this.emit();
		void this.sync();
	}

	async addOp(op: Op): Promise<number> {
		if (!this.db) this.db = await openOplogDb();
		this.pending = await appendOp(this.db, op);
		const version = ++this.opVersion;
		this.emit();
		if (this.pending >= OPLOG_SYNC_THRESHOLD) void this.sync();
		return version;
	}

	private pagehideUrl(): string {
		return `${window.location.origin}/sync`;
	}

	/** Pagehide dump: keepalive fetch, fire-and-forget, 64KB prefix rule. */
	private flushOnPagehide(): void {
		if (!this.db || this.pending === 0) return;
		const db = this.db;
		const fetchFn = this.io.fetchFn ?? fetch;
		void readOps(db).then((entries) => {
			if (entries.length === 0) return;
			const fit = keepalivePrefix(entries.map((e) => e.op));
			if (!fit) {
				console.warn('[infoto] first op exceeds the 64KB keepalive budget; kept for the next sync');
				return;
			}
			// Clear only the sent prefix; the remaining ops stay queued.
			const keys = entries.slice(0, fit.ops.length).map((e) => e.key);
			// Keepalive outcomes are uncertain, so failures retain every sent op.
			void fetchFn(this.pagehideUrl(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: fit.body,
				credentials: 'include',
				keepalive: true,
			})
				.then((r) => {
					if (r.ok) return clearAfter(db, keys);
				})
				.catch(() => undefined);
		});
	}

	private async applySnapshot(
		db: IDBDatabase,
		response: SyncResponse,
		context: SyncSnapshotContext,
	): Promise<void> {
		const mapping = this.io.onSyncResponse?.(response, context);
		if (mapping && mapping.size > 0) await remapQueuedTargets(db, mapping);
		await rebuildCache(db, response.photos).catch((error) => {
			console.warn('[sync] SHA cache rebuild failed', error);
		});
	}

	private async runSync(attempt: number): Promise<SyncAttemptResult> {
		if (!this.db) this.db = await openOplogDb();
		const db = this.db;
		const entries = await readOps(db);
		const maxVersion = entries.length > 0 ? this.opVersion : 0;
		this.syncing = true;
		this.emit();
		try {
			const { response } = await (this.io.postSyncFn ?? postSync)({
				ops: entries.map((entry) => entry.op),
			});
			await clearAfter(db, entries.map((entry) => entry.key));
			this.pending = await countOps(db);
			await this.applySnapshot(db, response, { attempt });
			return { ok: true, confirmedThroughVersion: maxVersion };
		} catch (error) {
			try {
				this.io.onError?.('submit', error);
			} catch {
				// Error reporting must not change sync completion semantics.
			}
			return { ok: false, error, confirmedThroughVersion: 0 };
		} finally {
			this.syncing = false;
			this.emit();
		}
	}

	private beginSync(): Promise<SyncAttemptResult> {
		const promise = this.runSync(++this.attempt);
		this.activeSync = promise;
		const clear = () => {
			if (this.activeSync === promise) this.activeSync = null;
		};
		void promise.then(clear, clear);
		return promise;
	}

	/** Awaitable manual, threshold, and site-open sync with request coalescing. */
	sync(): Promise<SyncAttemptResult> {
		return this.activeSync ?? this.beginSync();
	}

	/** Wait for an active attempt, then flush the requested op version if needed. */
	flushThrough(version: number): Promise<SyncAttemptResult> {
		if (this.criticalFlush) {
			this.criticalFlush.throughVersion = Math.max(this.criticalFlush.throughVersion, version);
			const pending = this.criticalFlush;
			return pending.promise.then((result) => {
				if (result.confirmedThroughVersion >= version) {
					return { ok: true, confirmedThroughVersion: result.confirmedThroughVersion };
				}
				return result;
			});
		}

		const record: NonNullable<SyncEngine['criticalFlush']> = {
			throughVersion: version,
			promise: Promise.resolve({ ok: false, error: new Error('uninitialized'), confirmedThroughVersion: 0 }),
		};
		const first = this.activeSync;
		record.promise = (first ? first.then((result) => result) : this.beginSync()).then(async (prior) => {
			if (prior.ok && prior.confirmedThroughVersion >= record.throughVersion) return prior;
			const next = await this.beginSync();
			if (next.ok) {
				return {
					ok: true,
					confirmedThroughVersion: Math.max(
						prior.confirmedThroughVersion,
						next.confirmedThroughVersion,
					),
				};
			}
			return {
				ok: false,
				error: next.error,
				confirmedThroughVersion: prior.confirmedThroughVersion,
			};
		});
		this.criticalFlush = record;
		void record.promise.then(() => {
			if (this.criticalFlush === record) this.criticalFlush = null;
		});
		return record.promise.then((result) => {
			if (result.confirmedThroughVersion >= version) {
				return { ok: true, confirmedThroughVersion: result.confirmedThroughVersion };
			}
			return result;
		});
	}

	/** Register all triggers; keep pagehide and hidden-document sync separate. */
	install(windowObj: Window = window): void {
		windowObj.addEventListener('pagehide', () => {
			this.flushOnPagehide();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') void this.sync();
		});
	}
}

async function remapQueuedTargets(
	db: IDBDatabase,
	mapping: ReadonlyMap<number, number>,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('oplog', 'readwrite');
		const req = tx.objectStore('oplog').openCursor();
		req.onsuccess = () => {
			const cursor = req.result;
			if (!cursor) return;
			const op = cursor.value as Op;
			const remapped = remapOpTarget(op, mapping);
			if (remapped !== op) cursor.update(remapped);
			cursor.continue();
		};
		req.onerror = () => reject(req.error ?? new Error('oplog remap failed'));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('oplog remap failed'));
	});
}

async function clearAfter(db: IDBDatabase, keys: IDBValidKey[]): Promise<void> {
	if (keys.length === 0) return;
	const max = keys.reduce<number>((m, k) => Math.max(m, typeof k === 'number' ? k : 0), 0);
	if (max <= 0) return clearOps(db);
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('oplog', 'readwrite');
		tx.objectStore('oplog').delete(IDBKeyRange.upperBound(max, false));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('oplog clearAfter failed'));
	});
}

/** Get (or create) the global engine instance. */
export function getEngine(io: EngineIo = {}): SyncEngine {
	if (!globalScope.__infotoEngine) globalScope.__infotoEngine = new SyncEngine(io);
	return globalScope.__infotoEngine;
}
