// Sync on initialization, pagehide, or explicit request. Unsent operations persist in IndexedDB.

import { MAX_SYNC_OPS, type Op, type SyncRequest, type SyncResponse } from '$shared/types';
import { postSync } from './api/syncClient';
import { coalesceKey, type MarkSet } from './ops';
import {
  rebuildCache,
  appendOp,
  appendUpload,
  countOps,
  deleteOps,
  openOplogDb,
  putOp,
  readOps,
  readPhotoRecords,
  readSnapshot,
  removePhotos,
  retirePhotos,
  updatePhotoRecord,
  uploadOpShas,
  type PhotoRecord,
} from './oplog';

/** Browser hard limit for a keepalive request body. */
export const KEEPALIVE_BODY_LIMIT = 65_536;

/** Longest operation prefix within the UTF-8 keepalive byte budget and server operation limit. Returns null if the first operation exceeds the budget. */
export function keepalivePrefix(
  ops: Op[],
  budget: number = KEEPALIVE_BODY_LIMIT,
): { ops: Op[]; body: string } | null {
  const enc = new TextEncoder();
  const wrapper = enc.encode(JSON.stringify({ ops: [] })).length;
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
  return { ops: picked, body: JSON.stringify({ ops: picked }) };
}

export interface EngineIo {
  db?: IDBDatabase;
  fetchFn?: typeof fetch;
  postSyncFn?: typeof postSync;
  /** Response sink (store write). */
  onSyncResponse?: (r: SyncResponse, context: SyncSnapshotContext) => void;
  /** Last persisted snapshot, delivered before the first request so a returning visitor
   *  renders the album instead of an empty state for one round trip. */
  onCachedSnapshot?: (r: SyncResponse) => void;
  onError?: (phase: 'submit' | 'pagehide', e: unknown) => void;
}

export interface SyncSnapshotContext {
  /** Unconfirmed operations to reapply over the server snapshot. */
  queuedOps: Op[];
}

type SyncAttemptResult =
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
  private activeSync: Promise<SyncAttemptResult> | null = null;
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
    // Paint the last snapshot first: a returning visitor sees the album instead of the empty
    // state for the length of the first round trip. A read failure is not fatal — the sync
    // below still fills the store from the server.
    const cached = await readSnapshot(this.db).catch(() => null);
    if (cached) this.io.onCachedSnapshot?.(cached);
    this.pending = await countOps(this.db);
    this.emit();
    void this.sync();
  }

  /** Persist an operation and return its oplog key. An operation that supersedes a queued one
   *  on the same dimension (see `coalesceKey`) replaces it in place, so a toggled mark, a
   *  changed vote or a re-picked reaction costs one entry instead of a growing chain. */
  async addOp(op: Op): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    const superseded = await this.queuedKeyFor(op);
    if (superseded !== null) {
      await putOp(this.db, superseded, op);
      // The pending count is unchanged, so there is nothing for a listener to re-read.
      return Number(superseded);
    }
    const key = await appendOp(this.db, op);
    this.pending = await countOps(this.db);
    this.emit();
    return Number(key);
  }

  /**
   * The key of a queued op this one supersedes, or null to append. An op already claimed by an
   * in-flight request is never superseded: that request carries the old value, and a successful
   * response clears the key, which would take the replacement with it — a silently lost edit.
   * The scan runs only for ops that have a dimension at all, so a batch of uploads never pays
   * for it.
   */
  private async queuedKeyFor(op: Op): Promise<IDBValidKey | null> {
    const key = coalesceKey(op);
    if (key === null || !this.db) return null;
    const entries = await readOps(this.db);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (this.inFlightKeys.has(entry.key)) continue;
      if (coalesceKey(entry.op) === key) return entry.key;
    }
    return null;
  }

  /**
   * Persist an upload op and the photo record it belongs to in one transaction.
   *
   * The op is what the server applies; the record is what the page draws until it does. Writing
   * them separately is what left a window in which a photo was on the host with no durable trace
   * on either side — the record had been deleted and the op not yet appended.
   */
  async addUploadOp(op: Op, record: PhotoRecord): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    const key = await appendUpload(this.db, op, record);
    this.pending = await countOps(this.db);
    this.emit();
    return Number(key);
  }

  /** Every unconfirmed photo record, in upload order. A read, never a trigger. */
  async hostedPhotos(): Promise<PhotoRecord[]> {
    if (!this.db) this.db = await openOplogDb();
    return readPhotoRecords(this.db);
  }

  /** Write a pending photo's marks into its record, so they cannot outlive the photo. */
  async updatePhotoMarks(sha256: string, marks: MarkSet): Promise<void> {
    if (!this.db) this.db = await openOplogDb();
    await updatePhotoRecord(this.db, sha256, (record) => ({ ...record, marks }));
  }

  /**
   * Withdraw photos the user deleted: each record, the mark ops addressed to it and the upload op
   * the record owns, in one transaction for the whole selection. An op already claimed by an
   * in-flight request cannot be un-sent, so the caller files a `delete` op afterwards and the
   * server ends up correct whether that request lands or fails (create+delete, or nothing).
   */
  async withdrawPhotos(shas: readonly string[]): Promise<void> {
    if (shas.length === 0) return;
    if (!this.db) this.db = await openOplogDb();
    await removePhotos(this.db, shas);
    this.pending = await countOps(this.db);
    this.emit();
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
        const fit = keepalivePrefix(
          available.map((entry) => entry.op),
          KEEPALIVE_BODY_LIMIT,
        );
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
            if (response.ok) return deleteOps(db, keys);
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
    await rebuildCache(db, response).catch((error) => {
      console.warn('[sync] SHA cache rebuild failed', error);
    });
  }

  private async runSync(): Promise<SyncAttemptResult> {
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
        const request: SyncRequest = { ops: batch.map((entry) => entry.op) };
        const { response } = await (this.io.postSyncFn ?? postSync)(request, {
          keepalive: this.keepaliveEligible(request.ops),
        });
        await deleteOps(
          db,
          batch.map((entry) => entry.key),
        );
        for (const entry of batch) {
          this.inFlightKeys.delete(entry.key);
          confirmedThroughVersion = Math.max(confirmedThroughVersion, Number(entry.key));
        }
        this.pending = await countOps(db);
        const queuedOps = (await readOps(db)).map((entry) => entry.op);
        await this.applySnapshot(db, response, { queuedOps });
        // After the fold, never before. The retirement states the marks the record still carries
        // itself, so a client that never hydrated its in-memory mark map cannot lose them.
        await retirePhotos(db, uploadOpShas(batch.map((entry) => entry.op)), response.selfId).catch(
          (error) => console.warn('[sync] photo record cleanup failed', error),
        );
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
    const fit = keepalivePrefix(ops, KEEPALIVE_BODY_LIMIT);
    return fit !== null && fit.ops.length === ops.length;
  }

  private beginSync(): Promise<SyncAttemptResult> {
    const promise = this.runSync();
    this.activeSync = promise;
    const clear = () => {
      if (this.activeSync === promise) this.activeSync = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  /** Awaitable manual and site-open sync with request coalescing: edits made during an
   *  in-flight request stay queued for the next trigger. */
  sync(): Promise<SyncAttemptResult> {
    if (!this.activeSync) return this.beginSync();
    return this.activeSync;
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
