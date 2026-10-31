// The sync coordinator (ADR 0026 §8): one WebSocket per browser, shared by every tab
// through this SharedWorker. It owns the protocol — hello/lastSeq catch-up, the offline
// backlog flush, ack bookkeeping — and fans every server frame out to the tabs, whose
// engines apply it to their own stores. Tabs keep their per-tab optimistic state; this
// worker is the single sync writer, which is what makes the server's
// one-connection-per-user dedup safe.
//
// Ack bookkeeping is by client nonce: the server echoes each applied op's cid, and the
// coordinator deletes the queued entry carrying that cid. A superseded op changes nonce,
// so a stale echo can never delete its replacement — the failure mode the old
// request/response pairing had. A refused op (op_dropped) leaves the same way.
//
// The protocol core lives in CoordinatorCore so the unit suite can drive it without a
// SharedWorker; the worker shell only wires ports onto it.

import { WsClient, wsUrl, type WsSocket } from '../core/api/wsClient';
import { countOps, deleteOps, openOplogDb, readOps } from '../core/oplog';
import { MAX_SYNC_OPS, type AppliedOp, type WsServerFrame } from '$shared/types';

/** Messages tabs send the coordinator. */
export type TabMessage =
  | { kind: 'init' }
  | { kind: 'connect' }
  | { kind: 'verify'; token: string }
  | { kind: 'queued' }
  | { kind: 'flush' };

/** Messages the coordinator sends every tab. */
export type CoordinatorMessage =
  | { kind: 'state'; connected: boolean; syncing: boolean; pending: number }
  | { kind: 'frame'; frame: WsServerFrame }
  | { kind: 'dropped'; cid: string };

const LAST_SEQ_KEY = 'infoto-last-seq';
const FLUSH_DEBOUNCE_MS = 16;
const PING_INTERVAL_MS = 30_000;

export interface CoordinatorIo {
  /** Open the socket; defaults to the browser WebSocket against same-origin /ws. */
  wsFactory?: (url: string) => WsSocket;
  wsUrl?: string;
  /** Injected oplog database (tests); the worker opens the real one. */
  db?: IDBDatabase;
  /** Frame sink — the worker fans frames out to every tab. */
  onFrame: (frame: WsServerFrame) => void;
  /** State sink — connected/syncing/pending, mirrored by each tab's engine. */
  onState: (state: { connected: boolean; syncing: boolean; pending: number }) => void;
  /** An op the server refused to apply; the owning tab rolls its optimistic state back. */
  onDropped: (cid: string) => void;
}

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

/**
 * The protocol core: connection lifecycle, catch-up, the backlog flush, and ack
 * bookkeeping. One instance per browser (inside the SharedWorker).
 */
export class CoordinatorCore {
  private io: CoordinatorIo;
  private ws: WsClient;
  private db: IDBDatabase | null = null;
  private connected = false;
  private syncing = false;
  private pending = 0;
  private selfId = -1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private welcome: Deferred<void> | null = null;
  private pendingToken: string | null = null;
  readonly state = { connected: false, syncing: false, pending: 0 };

  constructor(io: CoordinatorIo) {
    this.io = io;
    this.ws = new WsClient({
      factory: io.wsFactory,
      url: io.wsUrl ?? wsUrl(),
      onOpen: () => this.sendHello(),
      onClose: () => this.onSocketDown(),
      onError: (e) => this.onSocketDown(e),
      onFrame: (frame) => this.onFrame(frame),
    });
  }

  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = this.io.db ?? (await openOplogDb());
    return this.db;
  }

  private lastSeq(): number {
    try {
      const raw = localStorage.getItem(LAST_SEQ_KEY);
      const n = raw === null ? 0 : Number(raw);
      return Number.isSafeInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private saveLastSeq(seq: number): void {
    try {
      localStorage.setItem(LAST_SEQ_KEY, String(seq));
    } catch {
      /* private mode: catch-up simply restarts from zero next launch */
    }
  }

  private emit(): void {
    this.state.connected = this.connected;
    this.state.syncing = this.syncing;
    this.state.pending = this.pending;
    this.io.onState({ ...this.state });
  }

  private async refreshPending(): Promise<void> {
    this.pending = await countOps(await this.ensureDb());
    this.emit();
  }

  // ---------- lifecycle ----------

  /** A tab registered (or asked to retry): open the socket when it is not open. */
  connect(): void {
    if (this.connected) {
      void this.flush();
      return;
    }
    this.welcome ??= deferred();
    this.ws.connect();
  }

  verify(token: string): void {
    this.pendingToken = token;
    if (this.ws.connected) this.sendHello();
  }

  private sendHello(): void {
    const frame: { type: 'hello'; turnstileToken?: string; lastSeq: number } = {
      type: 'hello',
      lastSeq: this.lastSeq(),
    };
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
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.emit();
    if (this.welcome) {
      this.welcome.promise.catch(() => undefined);
      this.welcome.reject(error ?? new Error('websocket_connect_failed'));
      this.welcome = null;
    }
  }

  private onFrame(frame: WsServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.pendingToken = null;
        this.connected = true;
        this.selfId = frame.selfId;
        this.startPing();
        // Queue entries without a nonce predate the coordinator; the welcome snapshot is
        // the server's current state and those entries were flushed by the previous
        // build's client, so keeping them would only re-apply unconfirmed ops.
        void (async () => {
          const db = await this.ensureDb();
          const stale = (await readOps(db)).filter((entry) => !entry.op.cid);
          if (stale.length > 0)
            await deleteOps(
              db,
              stale.map((entry) => entry.key),
            );
          await this.refreshPending();
        })();
        this.io.onFrame(frame);
        this.emit();
        this.welcome?.resolve();
        this.welcome = null;
        void this.flush();
        return;
      }
      case 'error':
        if (frame.error === 'op_dropped') {
          if (frame.cid) {
            this.io.onDropped(frame.cid);
            void this.dropByCid(frame.cid);
          }
          return;
        }
        this.io.onFrame(frame);
        return;
      case 'ops':
        this.onBroadcast(frame.applied);
        this.io.onFrame(frame);
        return;
      case 'pong':
        return;
    }
  }

  /** An echo of our own ingest confirms the queued entries carrying those nonces; a
   *  foreign batch only advances lastSeq. A broadcast frame is one ingest batch from
   *  one connection, so the actor is uniform across it. */
  private onBroadcast(applied: AppliedOp[]): void {
    if (applied.length === 0) return;
    let maxSeq = this.lastSeq();
    for (const a of applied) if (a.seq > maxSeq) maxSeq = a.seq;
    this.saveLastSeq(maxSeq);
    const self = this.selfId >= 0 && applied[0]!.actor === this.selfId;
    if (!self) {
      void this.refreshPending();
      return;
    }
    const cids = new Set(applied.map((a) => a.cid).filter((cid): cid is string => !!cid));
    void (async () => {
      const db = await this.ensureDb();
      const entries = await readOps(db);
      const confirmed = entries
        .filter((entry) => entry.op.cid !== undefined && cids.has(entry.op.cid))
        .map((entry) => entry.key);
      if (confirmed.length > 0) await deleteOps(db, confirmed);
      await this.refreshPending();
      // The confirmed backlog may have freed the queue; keep flushing while anything
      // the server has not seen remains.
      if (this.pending > 0 && this.connected) void this.flush();
    })();
  }

  /** A refused op will never apply: its queue entry goes the same way as a confirmed
   *  one, and the owning tab rolls its optimistic state back. */
  private async dropByCid(cid: string): Promise<void> {
    const db = await this.ensureDb();
    const entries = await readOps(db);
    const doomed = entries.filter((entry) => entry.op.cid === cid).map((entry) => entry.key);
    if (doomed.length > 0) await deleteOps(db, doomed);
    await this.refreshPending();
  }

  // ---------- flush ----------

  /** Send the whole pending backlog in as few frames as the op cap allows. The welcome
   *  exchange already fetched the snapshot; a flush with nothing queued does nothing. */
  async flush(): Promise<void> {
    if (!this.connected) return;
    if (this.syncing) {
      this.scheduleFlush();
      return;
    }
    this.syncing = true;
    this.emit();
    try {
      const db = await this.ensureDb();
      const entries = await readOps(db);
      for (let offset = 0; offset < entries.length; offset += MAX_SYNC_OPS) {
        if (!this.ws.connected) break;
        const batch = entries.slice(offset, offset + MAX_SYNC_OPS);
        this.ws.send({ type: 'ops', ops: batch.map((entry) => entry.op) });
      }
      this.pending = entries.length;
      this.emit();
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  /** A tab appended an op: recount and schedule the flush within a frame. */
  queued(): void {
    void this.refreshPending().then(() => this.scheduleFlush());
  }

  private scheduleFlush(): void {
    if (!this.connected || this.flushTimer !== null || this.pending === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Page-exit trigger: flush immediately, skipping the debounce. */
  flushNow(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
  }

  /** Tab message entry point. */
  async message(message: TabMessage): Promise<void> {
    switch (message.kind) {
      case 'init':
        await this.refreshPending();
        this.connect();
        return;
      case 'connect':
        this.connect();
        return;
      case 'verify':
        this.verify(message.token);
        return;
      case 'queued':
        this.queued();
        return;
      case 'flush':
        this.flushNow();
        return;
    }
  }
}

/** The SharedWorker shell: every tab's port is one fan-out receiver; the core is the
 *  single protocol owner. Extracted so the unit suite drives the core directly. */
export function attachCoordinatorPort(
  core: CoordinatorCore,
  port: {
    addEventListener: (type: 'message', l: (ev: { data: TabMessage }) => void) => void;
    postMessage: (message: CoordinatorMessage) => void;
    start?: () => void;
  },
): void {
  port.addEventListener('message', (ev) => {
    void core.message(ev.data);
  });
  port.start?.();
}
