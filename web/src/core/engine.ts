// The per-tab sync engine over the coordinator transport (ADR 0026). Every op is
// persisted in the shared IndexedDB oplog first — with its client nonce (cid) and commit
// time (ct) — and the coordinator (one WebSocket per browser, ADR 0026 §8) owns the
// connection, the backlog flush, and the ack bookkeeping. This engine's remaining jobs:
// stamp and queue ops, apply what the server broadcasts to this tab's store, and mirror
// the connection state to the UI. Triggers stay ADR 0008's: page open, page exit, and
// the sync button, which exists only while the socket is not connected.

import type { AppliedOp, Op, SyncResponse, WsServerFrame } from '$shared/types';
import {
  appendOp,
  appendUpload,
  openOplogDb,
  putOp,
  readOps,
  readPhotoRecords,
  readSnapshot,
  rebuildCache,
  removePhotos,
  retirePhotos,
  updatePhotoRecord,
  type PhotoRecord,
} from './oplog';
import { coalesceKey, type MarkSet } from './ops';
import { inPageTransport, sharedWorkerTransport, type SyncTransport } from '../sync/transport';

export interface EngineIo {
  db?: IDBDatabase;
  /** Transport override (tests); defaults to the SharedWorker coordinator. */
  transport?: SyncTransport;
  /** Response sink (store write) — a whole snapshot from `welcome`. */
  onSyncResponse?: (r: SyncResponse, context: SyncSnapshotContext) => void;
  /** Last persisted snapshot, delivered before the first exchange so a returning visitor
   *  renders the album instead of an empty state while the socket opens. */
  onCachedSnapshot?: (r: SyncResponse) => void;
  /** Ops broadcast by the server that this tab did not originate — applied live. */
  onServerOps?: (applied: AppliedOp[]) => void;
  /** The echo of an op this tab originated: already applied optimistically, so the store
   *  only learns the server-assigned identity (a create's real id) through it. */
  onOwnEcho?: (applied: AppliedOp) => void;
  /** The server refused one of this tab's ops; the optimistic state rolls back. */
  onOpDropped?: (cid: string) => void;
  onError?: (phase: 'connect' | 'submit', e: unknown) => void;
  /** The server wants a Turnstile token before this device gets an identity; the app
   *  renders the widget and calls verify() with the answer. */
  onTurnstileRequired?: (siteKey: string | null) => void;
}

export interface SyncSnapshotContext {
  /** Unconfirmed operations to reapply over the server snapshot. */
  queuedOps: Op[];
}

export type SyncAttemptResult = { ok: true } | { ok: false; error: unknown };

export interface EngineState {
  /** true = the coordinator has a flush in flight (ops keep accumulating). */
  syncing: boolean;
  /** Pending op count across the browser (snapshot, for the button badge). */
  pending: number;
  /** The shared socket is open and authenticated. The sync button hides on true and
   *  shows on false — offline, dropped, kicked, or still negotiating (ADR 0026). */
  connected: boolean;
}

const CONNECT_TIMEOUT_MS = 15_000;
/** Sliding cookie window; matches the server's session cookie (400-day browser cap). */
const COOKIE_MAX_AGE_S = 34_560_000;

const globalScope = globalThis as unknown as { __infotoEngine?: SyncEngine };

/** Sync engine — one per tab. The transport is shared; the stores are not. */
export class SyncEngine {
  private db: IDBDatabase | null = null;
  private io: EngineIo;
  private transport: SyncTransport;
  private listeners = new Set<(s: EngineState) => void>();
  private pending = 0;
  private connected = false;
  private syncing = false;
  /** Cids this tab originated and has not seen echoed; their broadcast skips the apply,
   *  because the optimistic state is already on screen. A superseded op keeps its nonce
   *  here on purpose: its echo must stay skipped even though the queue entry moved on. */
  private recentCids = new Set<string>();
  private pagehideInstalled = false;
  readonly state: EngineState = { syncing: false, pending: 0, connected: false };

  constructor(io: EngineIo = {}) {
    this.io = io;
    this.db = io.db ?? null;
    this.transport =
      io.transport ??
      // Safari on iOS ships no SharedWorker: the coordinator then runs in this page, so a
      // tab syncs through its own socket (see transport.inPageTransport).
      sharedWorkerTransport() ??
      inPageTransport();
    this.transport.onFrame((frame) => this.onFrame(frame));
    this.transport.onDropped((cid) => {
      this.recentCids.delete(cid);
      try {
        this.io.onOpDropped?.(cid);
      } catch {
        // A rollback must never break the frame pump.
      }
    });
    this.transport.onState((s) => {
      this.connected = s.connected;
      this.syncing = s.syncing;
      this.pending = s.pending;
      this.emit();
    });
  }

  /** Adopt a new set of callbacks (a remounted page supplies its own store). */
  rebind(io: EngineIo): void {
    if (io.db) this.db = io.db;
    this.io = { ...this.io, ...io };
  }

  private emit(): void {
    this.state.syncing = this.syncing;
    this.state.pending = this.pending;
    this.state.connected = this.connected;
    for (const l of this.listeners) l({ ...this.state });
  }

  onState(l: (s: EngineState) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async init(): Promise<void> {
    if (!this.db) this.db = await openOplogDb();
    // Paint the last snapshot first: a returning visitor sees the album instead of the
    // empty state while the socket opens. A read failure is not fatal — the welcome
    // snapshot replaces it moments later.
    const cached = await readSnapshot(this.db).catch(() => null);
    if (cached) this.io.onCachedSnapshot?.(cached);
    this.transport.init();
  }

  /** Open the shared connection. Never retried in the background: the visible sync
   *  button is the retry, and ops keep queuing in IndexedDB meanwhile. */
  connect(): void {
    this.transport.connect();
  }

  /** Ride a Turnstile token on the coordinator's next hello. */
  verify(token: string): void {
    this.transport.verify(token);
  }

  private onFrame(frame: WsServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.mirrorCookie(frame.uuid);
        if (frame.snapshot) {
          const response: SyncResponse = {
            ...frame.snapshot,
            selfId: frame.selfId,
            mediaHostUrl: frame.mediaHostUrl,
            // Feedback is real for the root only; a non-root store keeps its own empty.
            feedback: frame.selfId === 0 ? frame.snapshot.feedback : [],
          };
          void this.applySnapshot(response);
        }
        // Catch-up replay: history this tab has not applied, in order, on top of the
        // snapshot (or on top of live state in the incremental case).
        if (frame.ops && frame.ops.length > 0) {
          this.applyForeign(frame.ops);
        }
        return;
      }
      case 'ops': {
        const own: AppliedOp[] = [];
        const foreign: AppliedOp[] = [];
        for (const applied of frame.applied) {
          if (applied.cid && this.recentCids.has(applied.cid)) own.push(applied);
          else foreign.push(applied);
        }
        this.applyForeign(foreign);
        for (const applied of own) {
          try {
            this.io.onOwnEcho?.(applied);
          } catch (e) {
            console.error('[sync] own echo handling failed', e);
          }
        }
        return;
      }
      case 'error':
        if (frame.error === 'turnstile_required' || frame.error === 'turnstile_failed') {
          this.io.onTurnstileRequired?.(frame.turnstileSiteKey ?? null);
          return;
        }
        this.io.onError?.('submit', new Error(frame.error));
        return;
      case 'pong':
        return;
    }
  }

  private applyForeign(applied: AppliedOp[]): void {
    if (applied.length === 0) return;
    try {
      this.io.onServerOps?.(applied);
    } catch (e) {
      console.error('[sync] broadcast apply failed', e);
    }
  }

  /** Fresh identities learn their uuid here; the cookie is what the next WS handshake
   *  and the admin routes read. JS cannot set HttpOnly, so the next handshake re-issues it. */
  private mirrorCookie(uuid: string): void {
    if (!uuid || typeof document === 'undefined') return;
    const parts = [
      `uuid=${encodeURIComponent(uuid)}`,
      'Path=/',
      'SameSite=Lax',
      `Max-Age=${COOKIE_MAX_AGE_S}`,
    ];
    if (location.protocol === 'https:') parts.push('Secure');
    document.cookie = parts.join('; ');
  }

  private async applySnapshot(response: SyncResponse): Promise<void> {
    if (!this.db) this.db = await openOplogDb();
    const queuedOps = (await readOps(this.db).catch(() => [])).map((entry) => entry.op);
    this.io.onSyncResponse?.(response, { queuedOps });
    await rebuildCache(this.db, response).catch((error) => {
      console.warn('[sync] SHA cache rebuild failed', error);
    });
    // The snapshot is authoritative: every record whose sha it carries (or whose uploader
    // is this identity) is now confirmed and leaves the pending set.
    await retirePhotos(
      this.db,
      response.photos.map((photo) => photo.sha256),
      response.selfId,
    ).catch((error) => console.warn('[sync] photo record cleanup failed', error));
  }

  /** Persist an operation and return its oplog key. An operation that supersedes a queued
   *  one on the same dimension (see `coalesceKey`) replaces it in place, so a toggled
   *  mark, a changed vote or a re-picked reaction costs one entry instead of a chain. The
   *  superseded op's nonce stays in the skip set on purpose: its echo must never apply
   *  the stale value over the replacement's optimistic state. */
  async addOp(op: Op): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    // A caller that already assigned a nonce keeps it: the store registers its ack handlers
    // by that cid, so regenerating one here would strand the optimistic row forever.
    const stamped: Op = { ...op, cid: op.cid ?? crypto.randomUUID(), ct: op.ct ?? Date.now() };
    const superseded = await this.queuedKeyFor(stamped);
    this.recentCids.add(stamped.cid!);
    if (superseded !== null) {
      await putOp(this.db, superseded, stamped);
      // The pending count is unchanged, so there is nothing for a listener to re-read.
      this.transport.queued();
      return Number(superseded);
    }
    const key = await appendOp(this.db, stamped);
    this.pending += 1;
    this.emit();
    this.transport.queued();
    return Number(key);
  }

  /** The key of a queued op this one supersedes, or null to append. */
  private async queuedKeyFor(op: Op): Promise<IDBValidKey | null> {
    const key = coalesceKey(op);
    if (key === null || !this.db) return null;
    const entries = await readOps(this.db);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
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
    // A caller that already assigned a nonce keeps it: the store registers its ack handlers
    // by that cid, so regenerating one here would strand the optimistic row forever.
    const stamped: Op = { ...op, cid: op.cid ?? crypto.randomUUID(), ct: op.ct ?? Date.now() };
    const key = await appendUpload(this.db, stamped, record);
    this.recentCids.add(stamped.cid!);
    this.pending += 1;
    this.emit();
    this.transport.queued();
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
   * Withdraw photos the user deleted: each record, the mark ops addressed to it and the
   * upload op the record owns, in one transaction for the whole selection. An op already
   * carried by an in-flight frame cannot be un-sent, so the caller files a `delete` op
   * afterwards and the server ends up correct whether that frame lands or fails
   * (create+delete, or nothing).
   */
  async withdrawPhotos(shas: readonly string[]): Promise<void> {
    if (shas.length === 0) return;
    if (!this.db) this.db = await openOplogDb();
    await removePhotos(this.db, shas);
    this.transport.queued();
  }

  /** Awaitable manual sync: make sure the shared connection is up, then let the
   *  coordinator flush. Edits made meanwhile ride the same queue. */
  sync(): Promise<SyncAttemptResult> {
    if (this.connected) {
      this.transport.flush();
      return Promise.resolve({ ok: true });
    }
    this.transport.connect();
    return new Promise<SyncAttemptResult>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve({ ok: false, error: new Error('connect_timeout') });
      }, CONNECT_TIMEOUT_MS);
      const unsubscribe = this.onState((s) => {
        if (!s.connected) return;
        clearTimeout(timer);
        unsubscribe();
        this.transport.flush();
        resolve({ ok: true });
      });
    });
  }

  /** Page-exit trigger: the coordinator flushes immediately, skipping its debounce.
   *  Best effort — the ops are durable in IndexedDB either way, and a frame that dies
   *  with the page is resent next session (its cid makes that idempotent). */
  install(windowObj: Window = window): void {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    windowObj.addEventListener('pagehide', () => {
      this.transport.flush();
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
