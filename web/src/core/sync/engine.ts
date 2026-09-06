// Sync triggers (spec): site open / pagehide / visibilitychange→hidden /
// op-log at 256 entries / manual.
// The pagehide handler is registered separately from visibilitychange→hidden
// (the contract's token-audit clause applies here too).

import type { Op, SyncResponse } from '$shared/types';
import { postSync } from '../api/syncClient';
import { OPLOG_SYNC_THRESHOLD, appendOp, clearOps, countOps, openOplogDb, readOps } from '../oplog/store';

export interface EngineIo {
	db?: IDBDatabase;
	fetchFn?: typeof fetch;
	postSyncFn?: typeof postSync;
	/** Response sink (store write). */
	onSyncResponse?: (r: SyncResponse) => void;
	onError?: (phase: 'submit' | 'pagehide', e: unknown) => void;
}

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
	readonly state: EngineState = { syncing: false, pending: 0 };

	constructor(io: EngineIo = {}) {
		this.io = io;
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

	async init(): Promise<void> {
		if (!this.db) this.db = await openOplogDb();
		this.pending = await countOps(this.db);
		this.emit();
		// trigger one sync when the site opens
		void this.sync();
	}

	async addOp(op: Op): Promise<void> {
		if (!this.db) this.db = await openOplogDb();
		this.pending = await appendOp(this.db, op);
		this.emit();
		if (this.pending >= OPLOG_SYNC_THRESHOLD) void this.sync();
	}

	private pagehideUrl(): string {
		return `${window.location.origin}/sync`;
	}

	/** pagehide dump: keepalive fetch, fire-and-forget. */
	private flushOnPagehide(): void {
		if (!this.db || this.pending === 0) return;
		const db = this.db;
		void readOps(db).then((entries) => {
			if (entries.length === 0) return;
			const body = JSON.stringify({ ops: entries.map((e) => e.op) });
			const keys = entries.map((e) => e.key);
			// keepalive results are unknowable; on failure ops stay in the log
			// and are resent on the next sync (ops are idempotent)
			void this.io.fetchFn?.(this.pagehideUrl(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				credentials: 'include',
				keepalive: true,
			})
				.then((r) => {
					if (r.ok) return clearAfter(db, keys);
				})
				.catch(() => undefined);
		});
	}

	/** Manual / threshold / site-open triggered sync. */
	async sync(): Promise<void> {
		if (this.syncing) return; // ops accumulate during sync; operations never block
		if (!this.db) await this.init();
		const db = this.db!;
		const entries = await readOps(db);
		if (entries.length === 0) {
			// sync once even with an empty log: refresh the cookie (sliding
			// expiry) and pull the full snapshot
			try {
				const { response } = await (this.io.postSyncFn ?? postSync)({ ops: [] });
				this.io.onSyncResponse?.(response);
			} catch (e) {
				this.io.onError?.('submit', e);
			}
			return;
		}
		this.syncing = true;
		this.emit();
		try {
			const ops = entries.map((e) => e.op);
			const { response } = await (this.io.postSyncFn ?? postSync)({ ops });
			// clear only after success (spec). Ops added during the sync have keys
			// greater than this snapshot's max key — the cleanup range is capped
			// at the snapshot so no op is lost.
			await clearAfter(db, entries.map((e) => e.key));
			this.pending = await countOps(db);
			this.io.onSyncResponse?.(response);
		} catch (e) {
			this.io.onError?.('submit', e);
		} finally {
			this.syncing = false;
			this.emit();
		}
	}

	/**
	 * Register all triggers. pagehide is registered separately (spec);
	 * never merged with visibilitychange→hidden.
	 */
	install(windowObj: Window = window): void {
		windowObj.addEventListener('pagehide', () => {
			this.flushOnPagehide();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.flushOnPagehide();
		});
	}
}

async function clearAfter(db: IDBDatabase, keys: IDBValidKey[]): Promise<void> {
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
