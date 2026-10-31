// Sync over the /ws WebSocket (ADR 0026). Operations persist in IndexedDB first; the
// socket is only the transport. Triggers stay ADR 0008's — page open, page exit, and the
// explicit sync button, which exists only while the socket is not connected: a broken
// connection is retried by the user, never in the background. While connected, a commit
// flushes promptly and a burst coalesces into one frame; offline, the queue grows with
// client-stamped timestamps and the whole backlog leaves in one frame on reconnect.

import {
  MAX_SYNC_OPS,
  type Op,
  type SyncResponse,
  type WsClientFrame,
  type WsServerFrame,
} from '$shared/types';
import { WsClient, type WsSocket } from './api/wsClient';
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

export interface EngineIo {
  db?: IDBDatabase;
  /** Socket factory override (tests); defaults to the browser WebSocket. */
  wsFactory?: (url: string) => WsSocket;
  /** Endpoint override (tests); defaults to the same-origin /ws. */
  wsUrl?: string;
  /** Response sink (store write). */
  onSyncResponse?: (r: SyncResponse, context: SyncSnapshotContext) => void;
  /** Last persisted snapshot, delivered before the first sync so a returning visitor
   *  renders the album instead of an empty state while the socket opens. */
  onCachedSnapshot?: (r: SyncResponse) => void;
  onError?: (phase: 'submit' | 'pagehide' | 'connect', e: unknown) => void;
  /** The server refused hello without a token; the app renders the widget and calls
   *  verify() with the answer. `siteKey` is the server's public key, cached across
   *  attempts so a repeat refusal can still render one. */
  onTurnstileRequired?: (siteKey: string | null) => void;
}

export interface SyncSnapshotContext {
  /** Unconfirmed operations to reapply over the server snapshot. */
  queuedOps: Op[];
}

export type SyncAttemptResult = { ok: true } | { ok: false; error: unknown };

export interface EngineState {
  /** true = a sync exchange is in flight (ops keep accumulating; operations are never blocked). */
  syncing: boolean;
  /** Pending op count (snapshot, for the button badge). */
  pending: number;
  /** The /ws socket is open and authenticated. The sync button hides on true and shows
   *  on false — offline, dropped, or still negotiating (ADR 0026). */
  connected: boolean;
}

const SYNC_REPLY_TIMEOUT_MS = 15_000;
/** One animation frame of slack for a connected commit: a click handler committing several
 *  ops (a batch mark, a vote plus a reaction) rides one frame instead of one frame per op —
 *  each frame costs a full snapshot on the way back. */
const FLUSH_DEBOUNCE_MS = 16;
/** Liveness only: keeps proxies from reaping an idle socket, and a dead one surfaces
 *  through close. It syncs nothing. */
const PING_INTERVAL_MS = 30_000;
/** Sliding cookie window; matches the server's session cookie (400-day browser cap). */
const COOKIE_MAX_AGE_S = 34_560_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The synced frame carries a full snapshot; a malformed one is a server bug, never a
 *  shape to rebuild the stores from. The HTTP client used to assert the same thing. */
function isValidSyncResponse(r: unknown): r is SyncResponse {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    o.ok === true &&
    Number.isSafeInteger(o.selfId) &&
    Number.isFinite(o.serverTime) &&
    typeof o.mediaHostUrl === 'string' &&
    Array.isArray(o.photos) &&
    Array.isArray(o.announcements) &&
    Array.isArray(o.polls) &&
    Array.isArray(o.feedback)
  );
}

const globalScope = globalThis as unknown as { __infotoEngine?: SyncEngine };

/** Sync engine — singleton. */
export class SyncEngine {
  private db: IDBDatabase | null = null;
  private io: EngineIo;
  private ws: WsClient;
  private listeners = new Set<(s: EngineState) => void>();
  private syncing = false;
  private pending = 0;
  private connected = false;
  private activeSync: Promise<SyncAttemptResult> | null = null;
  private inFlightKeys = new Set<IDBValidKey>();
  private pagehideInstalled = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** The most recent server-supplied Turnstile site key. */
  private siteKey: string | null = null;
  /** A token to ride the next hello (set by verify()). */
  private pendingToken: string | null = null;
  /** Resolved when the socket is open and authenticated; rejected on transport failure. */
  private welcome: Deferred<void> | null = null;
  /** The one outstanding sync frame's reply waiter. */
  private reply: Deferred<SyncResponse> | null = null;
  /** Coalesces commit bursts into one flush task. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  readonly state: EngineState = { syncing: false, pending: 0, connected: false };

  constructor(io: EngineIo = {}) {
    this.io = io;
    this.db = io.db ?? null;
    this.ws = new WsClient({
      factory: io.wsFactory,
      url: io.wsUrl,
      onOpen: () => this.sendHello(),
      onClose: () => this.onSocketDown(),
      onError: (e) => this.onSocketDown(e),
      onFrame: (frame) => this.onFrame(frame),
    });
  }

  /** Adopt a new set of callbacks (a remounted page supplies its own store). Injected
   *  values already present are kept, so a later caller only has to pass what changed. */
  rebind(io: EngineIo): void {
    if (io.db) this.db = io.db;
    this.io = { ...this.io, ...io };
    // Only defined overrides travel: a partial rebind must not strip the socket
    // factory the constructor injected.
    if (io.wsFactory !== undefined || io.wsUrl !== undefined) {
      this.ws.rebind({ factory: io.wsFactory, url: io.wsUrl });
    }
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
    // empty state while the socket opens. A read failure is not fatal — the sync below
    // still fills the store from the server.
    const cached = await readSnapshot(this.db).catch(() => null);
    if (cached) this.io.onCachedSnapshot?.(cached);
    this.pending = await countOps(this.db);
    this.emit();
    this.connect();
  }

  /** Open the socket. Never retried in the background: the visible sync button is the
   *  retry, and ops keep queuing in IndexedDB meanwhile. */
  connect(): void {
    if (this.connected) return;
    this.welcome ??= deferred();
    this.ws.connect();
  }

  /** Ride a Turnstile token on the next hello. Safe to call before the socket is open:
   *  the token goes out as soon as one is. */
  verify(token: string): void {
    this.pendingToken = token;
    if (this.ws.connected) this.sendHello();
  }

  private sendHello(): void {
    const frame: WsClientFrame = { type: 'hello' };
    if (this.pendingToken) frame.turnstileToken = this.pendingToken;
    this.ws.send(frame);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ws.send({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private onSocketDown(error?: unknown): void {
    this.stopPing();
    this.connected = false;
    this.syncing = false;
    // Unconfirmed frames stay queued: unmark them so a later flush carries them again.
    this.inFlightKeys.clear();
    this.reply?.reject(new Error('websocket_closed'));
    this.reply = null;
    if (this.welcome) {
      // Mark the rejection handled even when nobody awaits it (the page-open auto
      // connect has no caller) — an unhandled rejection must not surface.
      this.welcome.promise.catch(() => undefined);
      this.welcome.reject(error ?? new Error('websocket_connect_failed'));
      this.welcome = null;
    }
    this.emit();
  }

  private onFrame(frame: WsServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.pendingToken = null;
        this.connected = true;
        this.mirrorCookie(frame.uuid);
        this.startPing();
        this.emit();
        this.welcome?.resolve();
        this.welcome = null;
        // Page-open trigger: the backlog — and the fresh snapshot — leaves now, one frame.
        void this.beginSync();
        return;
      }
      case 'error':
        if (frame.error === 'turnstile_required' || frame.error === 'turnstile_failed') {
          if (frame.turnstileSiteKey) this.siteKey = frame.turnstileSiteKey;
          this.io.onTurnstileRequired?.(this.siteKey);
          return;
        }
        this.reply?.reject(new Error(frame.error));
        this.reply = null;
        this.io.onError?.('submit', new Error(frame.error));
        return;
      case 'synced':
        if (!isValidSyncResponse(frame.response)) {
          this.reply?.reject(new Error('invalid_sync_response'));
          this.reply = null;
          return;
        }
        this.reply?.resolve(frame.response);
        this.reply = null;
        return;
      case 'pong':
        return;
    }
  }

  /** Fresh identities learn their uuid here; the cookie is what the next WS handshake and
   *  the admin routes read. JS cannot set HttpOnly, so the next handshake re-issues it. */
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

  /** Persist an operation and return its oplog key. An operation that supersedes a queued one
   *  on the same dimension (see `coalesceKey`) replaces it in place, so a toggled mark, a
   *  changed vote or a re-picked reaction costs one entry instead of a growing chain. */
  async addOp(op: Op): Promise<number> {
    if (!this.db) this.db = await openOplogDb();
    const stamped: Op = { ts: Date.now(), ...op };
    const superseded = await this.queuedKeyFor(stamped);
    if (superseded !== null) {
      await putOp(this.db, superseded, stamped);
      // The pending count is unchanged, so there is nothing for a listener to re-read.
      return Number(superseded);
    }
    const key = await appendOp(this.db, stamped);
    this.pending = await countOps(this.db);
    this.emit();
    this.scheduleFlush();
    return Number(key);
  }

  /**
   * The key of a queued op this one supersedes, or null to append. An op already claimed by
   * an in-flight exchange is never superseded: that frame carries the old value, and a
   * successful response clears the key, which would take the replacement with it — a
   * silently lost edit. The scan runs only for ops that have a dimension at all, so a batch
   * of uploads never pays for it.
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
    const stamped: Op = { ts: Date.now(), ...op };
    const key = await appendUpload(this.db, stamped, record);
    this.pending = await countOps(this.db);
    this.emit();
    this.scheduleFlush();
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
   * in-flight exchange cannot be un-sent, so the caller files a `delete` op afterwards and the
   * server ends up correct whether that frame lands or fails (create+delete, or nothing).
   */
  async withdrawPhotos(shas: readonly string[]): Promise<void> {
    if (shas.length === 0) return;
    if (!this.db) this.db = await openOplogDb();
    await removePhotos(this.db, shas);
    this.pending = await countOps(this.db);
    this.emit();
  }

  /** A connected commit flushes within a frame, and a burst of commits — even ones an
   *  `await` splits across tasks — coalesces into one frame. An offline commit only
   *  queues: the sync button is the trigger. */
  private scheduleFlush(): void {
    if (!this.connected || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // A welcome exchange already fetched the snapshot; an empty queue has nothing to
      // carry and must not spend another full-snapshot reply on itself.
      if (this.pending === 0) return;
      void this.sync();
    }, FLUSH_DEBOUNCE_MS);
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

  /** Send one sync frame and wait for its full-snapshot reply. One frame in flight at a
   *  time; a reply that never comes unblocks the caller after a deadline. */
  private sendSyncFrame(ops: Op[]): Promise<SyncResponse> {
    const waiter = deferred<SyncResponse>();
    this.reply = waiter;
    const sent = this.ws.send({ type: 'sync', ops });
    if (!sent) {
      this.reply = null;
      return Promise.reject(new Error('websocket_not_open'));
    }
    const timeout = setTimeout(() => {
      if (this.reply === waiter) {
        this.reply = null;
        waiter.reject(new Error('sync_reply_timeout'));
      }
    }, SYNC_REPLY_TIMEOUT_MS);
    return waiter.promise.finally(() => clearTimeout(timeout));
  }

  private async runSync(): Promise<SyncAttemptResult> {
    let available: Awaited<ReturnType<typeof readOps>> = [];
    this.syncing = true;
    this.emit();
    try {
      if (!this.db) this.db = await openOplogDb();
      const db = this.db;
      available = (await readOps(db)).filter((entry) => !this.inFlightKeys.has(entry.key));
      for (const entry of available) this.inFlightKeys.add(entry.key);
      // Reserve the captured queue; later operations stay queued for the next flush.
      for (let offset = 0; offset < Math.max(1, available.length); offset += MAX_SYNC_OPS) {
        const batch = available.slice(offset, offset + MAX_SYNC_OPS);
        const response = await this.sendSyncFrame(batch.map((entry) => entry.op));
        await deleteOps(
          db,
          batch.map((entry) => entry.key),
        );
        for (const entry of batch) this.inFlightKeys.delete(entry.key);
        this.pending = await countOps(db);
        const queuedOps = (await readOps(db)).map((entry) => entry.op);
        await this.applySnapshot(db, response, { queuedOps });
        // After the fold, never before. The retirement states the marks the record still
        // carries itself, so a client that never hydrated its in-memory mark map cannot
        // lose them.
        await retirePhotos(db, uploadOpShas(batch.map((entry) => entry.op)), response.selfId).catch(
          (error) => console.warn('[sync] photo record cleanup failed', error),
        );
      }
      return { ok: true };
    } catch (error) {
      try {
        this.io.onError?.('submit', error);
      } catch {
        // Error reporting does not affect flush semantics.
      }
      return { ok: false, error };
    } finally {
      for (const entry of available) this.inFlightKeys.delete(entry.key);
      this.syncing = false;
      this.emit();
    }
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

  /** Awaitable manual and page-open sync with request coalescing: edits made during an
   *  in-flight exchange stay queued for the next trigger. A disconnected engine connects
   *  first and flushes once the session is welcome. */
  sync(): Promise<SyncAttemptResult> {
    if (this.activeSync) return this.activeSync;
    if (this.connected) return this.beginSync();
    this.connect();
    const pendingWelcome = this.welcome;
    if (!pendingWelcome)
      return Promise.resolve({ ok: false, error: new Error('websocket_unavailable') });
    return pendingWelcome.promise.then(
      () => this.activeSync ?? this.beginSync(),
      (error) => {
        try {
          this.io.onError?.('connect', error);
        } catch {
          // Reporting only.
        }
        return { ok: false, error };
      },
    );
  }

  /** Page-exit trigger: start the same coalesced exchange the button and a connected
   *  commit use, so the queue can never leave twice (a parallel dump would race the
   *  flush a pending commit had already scheduled). Best effort — the ops are durable in
   *  IndexedDB either way, and a frame that dies with the page is resent next session,
   *  the same exposure the keepalive fetch had. */
  install(windowObj: Window = window): void {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    windowObj.addEventListener('pagehide', () => {
      if (!this.ws.connected) return;
      void this.beginSync();
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
