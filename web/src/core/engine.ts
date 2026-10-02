// Sync on initialization, pagehide, or explicit request. Unsent operations persist in IndexedDB.

import {
  MAX_SYNC_OPS,
  type LocaleCode,
  type Op,
  type SyncRequest,
  type SyncResponse,
} from '$shared/types';
import { activeLocale } from '$shared/copy';
import { postSync } from './api/syncClient';
import { rebuildCache, appendOp, countOps, openOplogDb, readOps } from './oplog';

/** Browser hard limit for a keepalive request body. */
export const KEEPALIVE_BODY_LIMIT = 65_536;

/** Longest operation prefix within the UTF-8 keepalive byte budget and server operation limit. Returns null if the first operation exceeds the budget. */
export function keepalivePrefix(
  ops: Op[],
  budget: number = KEEPALIVE_BODY_LIMIT,
  locale: LocaleCode = activeLocale(),
): { ops: Op[]; body: string } | null {
  const enc = new TextEncoder();
  const wrapper = enc.encode(JSON.stringify({ ops: [], locale })).length;
  let bytes = wrapper;
  const picked: Op[] = [];
  for (const op of ops.slice(0, MAX_SYNC_OPS)) {
    const size = enc.encode(JSON.stringify(op)).length + (picked.length > 0 ? 1 : 0); // comma
    if (bytes + size > budget) {
      if (picked.length === 0) return null; // first op alone is oversize
      break;
    }
    bytes += size;
    picked.push(op);
  }
  return { ops: picked, body: JSON.stringify({ ops: picked, locale }) };
}

export interface EngineIo {
  db?: IDBDatabase;
  fetchFn?: typeof fetch;
  postSyncFn?: typeof postSync;
  /** Response sink (store write). */
  onSyncResponse?: (r: SyncResponse, context: SyncSnapshotContext) => void;
  onError?: (phase: 'submit' | 'pagehide', e: unknown) => void;
}

export interface SyncSnapshotContext {
  attempt: number;
  /** Unconfirmed operations to reapply over the server snapshot. */
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
  private activeSyncLocale: LocaleCode | null = null;
  private inFlightKeys = new Set<IDBValidKey>();
  private pagehideInstalled = false;
  readonly state: EngineState = { syncing: false, pending: 0 };

  constructor(io: EngineIo = {}) {
    this.io = io;
    this.db = io.db ?? null;
  }

  /** Adopt a new set of callbacks (a remounted page supplies its own store). Injected
   *  values already present are kept, so a later caller only has to pass what changed. */
  rebind(io: EngineIo): void {
    if (io.db) this.db = io.db;
    this.io = { ...this.io, ...io };
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
    void this.sync();
  }

  /** Persist an operation and return its monotonic oplog key. */
  async addOp(op: Op): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    const key = await appendOp(this.db, op);
    this.pending = await countOps(this.db);
    this.emit();
    return Number(key);
  }

  private pagehideUrl(): string {
    return `${window.location.origin}/sync`;
  }

  /** Send a bounded keepalive prefix on pagehide, excluding operations owned by another in-flight request. */
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
    this.io.onSyncResponse?.(response, context);
    await rebuildCache(db, response.photos).catch((error) => {
      console.warn('[sync] SHA cache rebuild failed', error);
    });
  }

  private async runSync(attempt: number, locale: LocaleCode): Promise<SyncAttemptResult> {
    let available: Awaited<ReturnType<typeof readOps>> = [];
    let confirmedThroughVersion = 0;
    this.syncing = true;
    this.emit();
    try {
      if (!this.db) this.db = await openOplogDb();
      const db = this.db;
      available = (await readOps(db)).filter((entry) => !this.inFlightKeys.has(entry.key));
      for (const entry of available) this.inFlightKeys.add(entry.key);
      // Reserve the captured queue; later operations stay queued for the next sync.
      for (let offset = 0; offset < Math.max(1, available.length); offset += MAX_SYNC_OPS) {
        const batch = available.slice(offset, offset + MAX_SYNC_OPS);
        const request: SyncRequest = { ops: batch.map((entry) => entry.op), locale };
        const { response } = await (this.io.postSyncFn ?? postSync)(request, {
          keepalive: this.keepaliveEligible(request.ops),
        });
        await clearKeys(
          db,
          batch.map((entry) => entry.key),
        );
        for (const entry of batch) {
          this.inFlightKeys.delete(entry.key);
          confirmedThroughVersion = Math.max(confirmedThroughVersion, Number(entry.key));
        }
        this.pending = await countOps(db);
        const queuedOps = (await readOps(db)).map((entry) => entry.op);
        await this.applySnapshot(db, response, { attempt, queuedOps });
      }
      return { ok: true, confirmedThroughVersion };
    } catch (error) {
      try {
        this.io.onError?.('submit', error);
      } catch {
        // Error reporting does not affect request completion.
      }
      return { ok: false, error, confirmedThroughVersion };
    } finally {
      for (const entry of available) this.inFlightKeys.delete(entry.key);
      this.syncing = false;
      this.emit();
    }
  }

  /** A request started on a hidden document dies with the page unless it is
   * keepalive, so the last edit before closing the tab can leave — but only when the
   * whole batch fits the browser's keepalive body cap. */
  private keepaliveEligible(ops: Op[]): boolean {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') return false;
    const fit = keepalivePrefix(ops);
    return fit !== null && fit.ops.length === ops.length;
  }

  private beginSync(locale: LocaleCode): Promise<SyncAttemptResult> {
    this.activeSyncLocale = locale;
    const promise = this.runSync(++this.attempt, locale);
    this.activeSync = promise;
    const clear = () => {
      if (this.activeSync === promise) {
        this.activeSync = null;
        this.activeSyncLocale = null;
      }
    };
    void promise.then(clear, clear);
    return promise;
  }

  /** Awaitable manual and site-open sync with request coalescing. A language change
   * queues a fresh localized snapshot immediately after the in-flight one completes. */
  sync(): Promise<SyncAttemptResult> {
    const locale = activeLocale();
    if (!this.activeSync) return this.beginSync(locale);
    if (this.activeSyncLocale === locale) return this.activeSync;
    return this.activeSync.then(() => this.sync());
  }

  /** Install the pagehide flush. Visibility changes do not trigger synchronization. */
  install(windowObj: Window = window): void {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    windowObj.addEventListener('pagehide', () => {
      this.flushOnPagehide();
    });
  }
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

/** Get (or create) the global engine instance; a caller that already has one adopts
 *  the new callbacks, so a remounted page takes over the single engine. */
export function getEngine(io: EngineIo = {}): SyncEngine {
  const existing = globalScope.__infotoEngine;
  if (!existing) {
    const created = new SyncEngine(io);
    globalScope.__infotoEngine = created;
    return created;
  }
  existing.rebind(io);
  return existing;
}
