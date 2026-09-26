// Sync triggers (spec): site open / pagehide / visibilitychange→hidden /
// op-log at 256 entries / manual. The pagehide handler is registered separately
// from visibilitychange→hidden (the contract's token-audit clause applies too).

import type { Op, SyncRequest, SyncResponse } from '$shared/types';
import { postSync } from '../api/syncClient';
import { remapOpTarget } from '../ops';
import { rebuildCache } from '../oplog/cache';
import { OPLOG_SYNC_THRESHOLD, appendOp, countOps, openOplogDb, readOps } from '../oplog/store';

/** Browser hard limit for a keepalive request body. */
export const KEEPALIVE_BODY_LIMIT = 65_536;

/**
 * Longest op prefix whose serialized SyncRequest fits the keepalive byte budget —
 * measured exactly with TextEncoder over the serialized JSON (wrapper and commas
 * included). Null only when the first op alone busts it (giant fb_create body); the caller warns and keeps it.
 */
export function keepalivePrefix(
  ops: Op[],
  budget: number = KEEPALIVE_BODY_LIMIT,
): { ops: Op[]; body: string } | null {
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
  onSyncResponse?: (r: SyncResponse, context: SyncSnapshotContext) => Map<number, number> | void;
  onError?: (phase: 'submit' | 'pagehide', e: unknown) => void;
}

export interface SyncSnapshotContext {
  attempt: number;
  /**
   * Ops still queued in the oplog when this snapshot landed (appended after the
   * request was read, or carried by a concurrent pagehide flush). The snapshot
   * cannot reflect them — the sink must fold them back on top or the optimistic
   * state reverts until the next sync.
   */
  queuedOps: Op[];
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
  private activeSync: Promise<SyncAttemptResult> | null = null;
  private inFlightKeys = new Set<IDBValidKey>();
  private criticalFlush: { throughVersion: number; promise: Promise<SyncAttemptResult> } | null =
    null;
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

  /**
   * Append one op and resolve with its version handle — the oplog record's
   * autoincrement key (monotonic, persisted, never reused; see appendOp).
   * Callers pass it to flushThrough to await server confirmation.
   */
  async addOp(op: Op): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    const key = await appendOp(this.db, op);
    this.pending = await countOps(this.db);
    this.emit();
    if (this.pending >= OPLOG_SYNC_THRESHOLD) void this.sync();
    return Number(key);
  }

  private pagehideUrl(): string {
    return `${window.location.origin}/sync`;
  }

  /**
   * Pagehide dump: keepalive fetch, fire-and-forget, 64KB prefix rule. Ops already carried
   * by an in-flight request are skipped — with no client op id the server cannot dedupe a
   * replay (a copy would apply twice), so they go out next session. `runSync` mirrors the filter.
   */
  private flushOnPagehide(): void {
    if (!this.db || this.pending === 0) return;
    const db = this.db;
    const fetchFn = this.io.fetchFn ?? fetch;
    void readOps(db)
      .then((entries) => {
        const available = entries.filter((entry) => !this.inFlightKeys.has(entry.key));
        if (available.length === 0) return;
        const fit = keepalivePrefix(available.map((entry) => entry.op));
        if (!fit) {
          console.warn('[infoto] first op exceeds the keepalive budget; kept for the next sync');
          return;
        }
        const keys = available.slice(0, fit.ops.length).map((entry) => entry.key);
        for (const key of keys) this.inFlightKeys.add(key);
        let request: Promise<Response>;
        try {
          request = fetchFn(this.pagehideUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: fit.body,
            credentials: 'include',
            keepalive: true,
          });
        } catch (error) {
          // A synchronous throw never reaches the chain below, so the keys
          // would otherwise stay marked and every later flush would skip them.
          for (const key of keys) this.inFlightKeys.delete(key);
          this.reportPagehideError(error);
          return;
        }
        void request
          .then((response) => {
            // Non-ok and a failed clear both leave the op queued, so the
            // next session resends it — never swallow that reason.
            if (response.ok) return clearKeys(db, keys);
            this.reportPagehideError(new Error(`pagehide flush rejected: HTTP ${response.status}`));
          })
          .catch((error: unknown) => this.reportPagehideError(error))
          .finally(() => {
            for (const key of keys) this.inFlightKeys.delete(key);
          });
      })
      .catch((error: unknown) => this.reportPagehideError(error));
  }

  private reportPagehideError(error: unknown): void {
    try {
      this.io.onError?.('pagehide', error);
    } catch {
      // Error reporting must not change flush semantics.
    }
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
    // Mirror of the pagehide filter: one op belongs to exactly one request at
    // a time — the server has no client op id to deduplicate a replay on.
    const available = entries.filter((entry) => !this.inFlightKeys.has(entry.key));
    // Confirmation must cover exactly the ops this request carries: an op excluded
    // because it is still in flight (pagehide keepalive) or not yet appended when the
    // snapshot was read must not be claimed, or flushThrough would report phantom success.
    const maxVersion =
      available.length > 0 ? Math.max(...available.map((entry) => Number(entry.key))) : 0;
    for (const entry of available) this.inFlightKeys.add(entry.key);
    this.syncing = true;
    this.emit();
    try {
      const request: SyncRequest = { ops: available.map((entry) => entry.op) };
      const { response } = await (this.io.postSyncFn ?? postSync)(request, {
        keepalive: this.keepaliveEligible(request.ops),
      });
      await clearKeys(
        db,
        available.map((entry) => entry.key),
      );
      this.pending = await countOps(db);
      // Ops appended after this request's op read (or owned by a concurrent pagehide
      // flush) are not in the snapshot — hand them along so the sink can re-fold them.
      const queuedOps = (await readOps(db))
        .filter((entry) => !this.inFlightKeys.has(entry.key))
        .map((entry) => entry.op);
      await this.applySnapshot(db, response, { attempt, queuedOps });
      return { ok: true, confirmedThroughVersion: maxVersion };
    } catch (error) {
      try {
        this.io.onError?.('submit', error);
      } catch {
        // Error reporting must not change sync completion semantics.
      }
      return { ok: false, error, confirmedThroughVersion: 0 };
    } finally {
      for (const entry of available) this.inFlightKeys.delete(entry.key);
      this.syncing = false;
      this.emit();
    }
  }

  /**
   * A request started on a hidden document dies with the page unless it is
   * keepalive, so the last edit before closing the tab can leave — but only
   * when the whole batch fits the browser's keepalive body cap.
   */
  private keepaliveEligible(ops: Op[]): boolean {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') return false;
    const fit = keepalivePrefix(ops);
    return fit !== null && fit.ops.length === ops.length;
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
      promise: Promise.resolve({
        ok: false,
        error: new Error('uninitialized'),
        confirmedThroughVersion: 0,
      }),
    };
    const first = this.activeSync;
    record.promise = (first ? first.then((result) => result) : this.beginSync()).then(
      async (prior) => {
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
      },
    );
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

async function clearKeys(db: IDBDatabase, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('oplog', 'readwrite');
    const store = tx.objectStore('oplog');
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('oplog clearKeys failed'));
  });
}

/** Get (or create) the global engine instance. */
export function getEngine(io: EngineIo = {}): SyncEngine {
  if (!globalScope.__infotoEngine) globalScope.__infotoEngine = new SyncEngine(io);
  return globalScope.__infotoEngine;
}
