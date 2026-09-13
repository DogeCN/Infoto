// Sync triggers (spec): site open / pagehide / visibilitychange→hidden /
// op-log at 256 entries / manual.
// The pagehide handler is registered separately from visibilitychange→hidden
// (the contract's token-audit clause applies here too).

import type { Op, SyncResponse } from '$shared/types';
import { postSync } from '../api/syncClient';
import { rebuildCache } from '../oplog/cache';
import { OPLOG_SYNC_THRESHOLD, appendOp, clearOps, countOps, openOplogDb, readOps } from '../oplog/store';

/** Browser hard limit for a keepalive request body (spec: "/sync 协议"). */
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

	/** pagehide dump: keepalive fetch, fire-and-forget, 64KB prefix rule (spec). */
	private flushOnPagehide(): void {
		if (!this.db || this.pending === 0) return;
		const db = this.db;
		const fetchFn = this.io.fetchFn ?? fetch;
		void readOps(db).then((entries) => {
			if (entries.length === 0) return;
			const fit = keepalivePrefix(entries.map((e) => e.op));
			if (!fit) {
				// a single op alone exceeds 64KB (only a giant ann_create body can
				// do this) — abandon this flush; the op stays queued, not lost
				console.warn('[infoto] first op exceeds the 64KB keepalive budget; kept for the next sync');
				return;
			}
			// only the ops actually sent may be removed after an ok response;
			// the rest wait for the next sync (all ops are idempotent, the
			// server applies them in order — a partial commit is safe)
			const keys = entries.slice(0, fit.ops.length).map((e) => e.key);
			// keepalive results are unknowable; on failure ops stay in the log
			// and are resent on the next sync
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

	/** Deliver a snapshot to the sink and refresh the local sha dedupe cache. */
	private async applySnapshot(db: IDBDatabase, response: SyncResponse): Promise<void> {
		this.io.onSyncResponse?.(response);
		await rebuildCache(db, response.photos).catch(() => undefined);
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
				await this.applySnapshot(db, response);
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
			await this.applySnapshot(db, response);
		} catch (e) {
			this.io.onError?.('submit', e);
		} finally {
			this.syncing = false;
			this.emit();
		}
	}

	/**
	 * Register all triggers (spec "同步触发点" / "主动降级"): pagehide carries the
	 * keepalive last-resort dump and is registered separately; a hidden page has
	 * not unloaded yet and can await, so visibilitychange→hidden runs a normal
	 * awaited /sync instead. Never merge the two handlers.
	 */
	install(windowObj: Window = window): void {
		windowObj.addEventListener('pagehide', () => {
			this.flushOnPagehide();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') void this.sync();
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
