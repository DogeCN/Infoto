import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import type {
  AlbumSnapshot,
  AppliedOp,
  Op,
  WsClientFrame,
  WsServerFrame,
} from '../../../src/shared/types';

// The album's write entry is the `/ws` WebSocket (ADR 0026), not the old HTTP `POST /sync`.
// These helpers stand in for the Durable Object so a spec can hand the page a snapshot and
// observe the ops it commits. A spec that mocks HTTP `/sync` mocks a route that no longer
// exists — the page would render the empty state and never sync.
//
// The socket does not live in the page: `sync/coordinator.ts` runs inside a SharedWorker
// (`name: 'infoto-sync'`), which `page.routeWebSocket` cannot intercept. `installSyncWorker`
// therefore replaces that ONE worker with an in-page port that dials the same `/ws` from the
// page, where the route CAN be intercepted. The transcode worker is left alone (it is
// constructed without a name) — replacing it would break every upload spec.

const STORE = 'oplog';

/** The `welcome` a real server sends. */
export interface LiveWelcome {
  type: 'welcome';
  selfId: number;
  uuid: string;
  mediaHostUrl: string;
  seq: number;
  snapshot?: AlbumSnapshot;
  ops?: AppliedOp[];
}

export interface AlbumSocket {
  /** Every client frame the page's coordinator sent, parsed. */
  readonly received: WsClientFrame[];
  /** The ops the page has queued, flattened and in send order. */
  submittedOps(): Op[];
  /** The ops the page sent in `ops` frames, in arrival order. */
  broadcast(applied: AppliedOp[]): void;
  /** Close the current connection from the server side (a dropped socket). */
  dropConnection(): void;
  /** Push a fresh `welcome` carrying this snapshot (a reconnect, or an admin import). */
  sendSnapshot(snapshot: Partial<AlbumSnapshot>): void;
}

export interface MockAlbumOptions {
  /** Snapshot delivered on `welcome`. Omitted collections default to empty. */
  snapshot?: Partial<AlbumSnapshot>;
  /** The connection's own id; `0` is root. Defaults to `0`. */
  selfId?: number;
  mediaHostUrl?: string;
  /**
   * Answer each `ops` frame the way the object does: stamp create ids, assign dense seqs,
   * and broadcast the batch back. Defaults to `true` — that is what the real server does.
   */
  echo?: boolean;
  /** Reply `op_dropped` for ops this predicate matches instead of accepting them. */
  refuse?: (op: Op) => boolean;
}

const EMPTY: AlbumSnapshot = { photos: [], announcements: [], polls: [], feedback: [] };

function isCreate(op: Op): boolean {
  return op.type === 'ann_create' || op.type === 'poll_create' || op.type === 'fb_create';
}

/**
 * Replace the sync SharedWorker with an in-page stand-in. Must run before the page's own
 * scripts (`page.addInitScript`), and before `mockAlbumSocket`.
 */
export async function installSyncWorker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ store }) => {
      const Real = (window as unknown as { SharedWorker: unknown }).SharedWorker as
        (new (url: unknown, opts?: { name?: string }) => unknown) | undefined;
      if (!Real) return;

      type Listener = (ev: { data: unknown }) => void;
      // Frames the coordinator posts to its port carry `kind`; wire frames carry `type`.
      type Wire = {
        kind?: string;
        type?: string;
        ops?: Op[];
        cid?: string;
        lastSeq?: number;
        token?: string;
        turnstileToken?: string;
      };

      (window as unknown as { SharedWorker: unknown }).SharedWorker = function (
        url: unknown,
        opts?: { name?: string },
      ) {
        if (opts?.name !== 'infoto-sync') return new Real(url, opts);
        const listeners: Listener[] = [];
        let socket: WebSocket | null = null;

        /** Pending ops straight from the shared IndexedDB queue the tabs write to. */
        const readQueued = (): Promise<{ key: IDBValidKey; op: Op }[]> =>
          new Promise((resolve) => {
            const open = indexedDB.open('infoto');
            open.onerror = () => resolve([]);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains(store)) return resolve([]);
              const out: { key: IDBValidKey; op: Op }[] = [];
              const tx = db.transaction(store, 'readonly');
              const cur = tx.objectStore(store).openCursor();
              cur.onsuccess = () => {
                const c = cur.result;
                if (c) {
                  out.push({ key: c.key, op: c.value as Op });
                  c.continue();
                }
              };
              tx.oncomplete = () => resolve(out);
            };
          });

        const dropQueued = (cid: string): Promise<void> =>
          new Promise((resolve) => {
            const open = indexedDB.open('infoto');
            open.onerror = () => resolve();
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains(store)) return resolve();
              const tx = db.transaction(store, 'readwrite');
              const cur = tx.objectStore(store).openCursor();
              cur.onsuccess = () => {
                const c = cur.result;
                if (c) {
                  const op = c.value as Op;
                  if (op.cid === cid) c.delete();
                  c.continue();
                }
              };
              tx.oncomplete = () => resolve();
            };
          });

        const emit = (message: unknown) => {
          for (const l of listeners) l({ data: message });
        };

        const pump = async (): Promise<void> => {
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          const queued = await readQueued();
          if (queued.length === 0) return;
          socket.send(JSON.stringify({ type: 'ops', ops: queued.map((q) => q.op) }));
        };

        /** A welcome has been applied on the current socket (the authenticated state). */
        let welcomed = false;
        /** The Turnstile token the page handed over, carried on the next hello. */
        let pendingToken: string | null = null;

        /** Open the socket and send the coordinator's hello. Only ever one at a time. */
        const dial = (): void => {
          // A socket is only "live" for our purposes while it is OPEN. After the page
          // closes one (a failed hello retry), the replacement must be able to dial even
          // if the old socket's `close` event has not been dispatched yet.
          if (socket && socket.readyState === WebSocket.OPEN) return;
          const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(`${proto}//${location.host}/ws`);
          socket = ws;
          welcomed = false;
          ws.addEventListener('open', () => {
            // The coordinator's real hello carries the persisted lastSeq, and the
            // Turnstile token when the page has produced one.
            const lastSeq = Number(localStorage.getItem('infoto-last-seq') ?? '0');
            const hello: Wire = { type: 'hello', lastSeq };
            if (pendingToken) hello.turnstileToken = pendingToken;
            ws.send(JSON.stringify(hello));
          });
          ws.addEventListener('message', (ev) => {
            let frame: WsServerFrame;
            try {
              frame = JSON.parse(String((ev as MessageEvent).data)) as WsServerFrame;
            } catch {
              return;
            }
            if (frame.type === 'welcome') {
              welcomed = true;
              emit({ kind: 'state', connected: true, syncing: false, pending: 0 });
            }
            if (frame.type === 'ops') {
              // Confirm the ops this batch echoes, the way the real coordinator does.
              const cids = frame.applied.map((a) => a.cid).filter((c): c is string => !!c);
              void Promise.all(cids.map(dropQueued));
            }
            if (frame.type === 'error' && frame.error === 'op_dropped' && frame.cid) {
              emit({ kind: 'dropped', cid: frame.cid });
              void dropQueued(frame.cid);
            }
            emit({ kind: 'frame', frame });
          });
          ws.addEventListener('close', () => {
            if (socket === ws) {
              socket = null;
              welcomed = false;
              emit({ kind: 'state', connected: false, syncing: false, pending: 0 });
            }
          });
        };

        /** A retry while the socket is still open but never authenticated: redial it.
         *  Mirrors `CoordinatorCore.connect()` — `WsClient.connect()` is a no-op on an
         *  open socket, so a refused hello would otherwise never be retried. */
        const retry = (): void => {
          if (socket && socket.readyState === WebSocket.OPEN && !welcomed) {
            try {
              socket.close();
            } catch {
              /* already closing */
            }
            socket = null;
          }
          dial();
        };

        const port = {
          addEventListener(_t: string, l: Listener) {
            listeners.push(l);
          },
          start() {},
          postMessage(msg: Wire) {
            switch (msg.kind ?? msg.type) {
              case 'init':
                // Page open: make sure a connection exists.
                dial();
                return;
              case 'connect':
                // The sync button's retry: an unauthenticated socket must be replaced,
                // exactly as `CoordinatorCore.connect()` does.
                retry();
                return;
              case 'queued':
              case 'flush':
                void pump();
                return;
              case 'verify':
                // The widget produced a token: ride it on a fresh hello.
                pendingToken = msg.token ?? null;
                retry();
                return;
              default:
                return;
            }
          },
        };

        return { port };
      };
    },
    { store: STORE },
  );
}

/**
 * Stand in for the album Durable Object on the `/ws` route. Install the sync worker first:
 * `await installSyncWorker(page)` then `await mockAlbumSocket(page, …)`.
 */
export async function mockAlbumSocket(
  page: Page,
  options: MockAlbumOptions = {},
): Promise<AlbumSocket> {
  const received: WsClientFrame[] = [];
  let routeRef: WebSocketRoute | null = null;
  const snapshot: AlbumSnapshot = { ...EMPTY, ...options.snapshot };
  const selfId = options.selfId ?? 0;
  const echo = options.echo ?? true;
  let seq = 0;

  const welcome = (): WsServerFrame => ({
    type: 'welcome',
    selfId,
    uuid: 'e2e-user',
    mediaHostUrl: options.mediaHostUrl ?? 'https://facade.test',
    seq,
    snapshot,
  });

  const send = (frame: WsServerFrame): void => {
    routeRef?.send(JSON.stringify(frame));
  };

  await page.routeWebSocket('**/ws', (route) => {
    routeRef = route;
    route.onMessage((message) => {
      if (typeof message !== 'string') return;
      let frame: WsClientFrame;
      try {
        frame = JSON.parse(message) as WsClientFrame;
      } catch {
        return;
      }
      received.push(frame);
      if (frame.type === 'hello') {
        send(welcome());
        return;
      }
      if (frame.type !== 'ops') return;
      const ops = frame.ops;
      const refused = options.refuse ? ops.filter(options.refuse) : [];
      for (const op of refused) {
        const cid = (op as { cid?: string }).cid;
        send({ type: 'error', error: 'op_dropped', ...(cid ? { cid } : {}) });
      }
      const accepted = options.refuse ? ops.filter((op) => !options.refuse!(op)) : ops;
      if (!echo || accepted.length === 0) return;
      const applied: AppliedOp[] = accepted.map((op) => {
        seq += 1;
        const stamped = isCreate(op) ? { ...op, payload: { ...(op.payload ?? {}), id: seq } } : op;
        return {
          seq,
          op: stamped,
          actor: selfId,
          ts: Date.now(),
          ...(op.cid ? { cid: op.cid } : {}),
        };
      });
      send({ type: 'ops', applied });
    });
  });

  return {
    received,
    submittedOps: () => received.flatMap((f) => (f.type === 'ops' ? f.ops : [])),
    broadcast: (applied) => send({ type: 'ops', applied }),
    dropConnection: () => {
      routeRef?.close();
      routeRef = null;
    },
    sendSnapshot: (next) => {
      Object.assign(snapshot, next);
      send(welcome());
    },
  };
}

/** An `ops` broadcast carrying one already-applied op — "another client wrote this". */
export function appliedOp(seq: number, op: Op, actor = 1): AppliedOp {
  return { seq, op, actor, ts: Date.now(), ...(op.cid ? { cid: op.cid } : {}) };
}

/**
 * A **real** album client for integration specs: it drives an actual `/ws` connection —
 * the Worker and Durable Object the Playwright webServer started — so a spec reads the
 * state a genuine client sees. The old HTTP `POST /sync` these specs used is gone.
 *
 * The socket runs **inside the page** on purpose: same-origin, the `uuid` cookie is sent
 * automatically, and Turnstile behaves exactly as in production. Node's `WebSocket` cannot
 * set a Cookie header, so it cannot express the root-identity case at all.
 */
export class LiveAlbum {
  private constructor(
    private page: Page,
    /** The identity this connection resolved to; `0` is root. */
    readonly selfId: number,
  ) {}

  /**
   * Dial `/ws` in the page and wait for `welcome`. `page` must already be on the app's
   * origin (a `goto` anywhere first), because the socket is same-origin.
   */
  static async connect(
    page: Page,
    opts: { turnstileToken?: string; lastSeq?: number; uuid?: string } = {},
  ): Promise<{ album: LiveAlbum; welcome: LiveWelcome }> {
    if (opts.uuid) {
      await page
        .context()
        .addCookies([{ name: 'uuid', value: opts.uuid, domain: 'localhost', path: '/' }]);
    }
    const welcome = (await page.evaluate(
      ({ token, lastSeq }) =>
        new Promise<unknown>((resolve, reject) => {
          const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new WebSocket(`${proto}//${location.host}/ws`);
          (window as unknown as { __liveAlbumSocket: WebSocket }).__liveAlbumSocket = socket;
          const timer = setTimeout(() => reject(new Error('welcome_timeout')), 15_000);
          const seen: unknown[] = [];
          const buffers = window as unknown as { __liveAlbumFrames?: unknown[] };
          buffers.__liveAlbumFrames = seen;
          socket.addEventListener('open', () => {
            const hello: { type: 'hello'; lastSeq: number; turnstileToken?: string } = {
              type: 'hello',
              lastSeq,
            };
            if (token) hello.turnstileToken = token;
            socket.send(JSON.stringify(hello));
          });
          socket.addEventListener('message', (ev) => {
            let frame: { type?: string; error?: string };
            try {
              frame = JSON.parse(String(ev.data));
            } catch {
              return;
            }
            seen.push(frame);
            if (frame.type === 'welcome') {
              clearTimeout(timer);
              resolve(frame);
            }
            if (frame.type === 'error' && frame.error !== 'op_dropped') {
              clearTimeout(timer);
              reject(new Error(frame.error));
            }
          });
          socket.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error('socket_error'));
          });
        }),
      { token: opts.turnstileToken ?? null, lastSeq: opts.lastSeq ?? 0 },
    )) as LiveWelcome;
    return { album: new LiveAlbum(page, welcome.selfId), welcome };
  }

  /** Send ops and read back the batch the server applied (or the refusal). */
  async apply(ops: Op[]): Promise<{ applied: AppliedOp[]; dropped: string[] }> {
    return (await this.page.evaluate(
      (opsToSend) =>
        new Promise<{ applied: unknown[]; dropped: string[] }>((resolve, reject) => {
          const socket = (window as unknown as { __liveAlbumSocket: WebSocket }).__liveAlbumSocket;
          const applied: unknown[] = [];
          const dropped: string[] = [];
          const timer = setTimeout(() => reject(new Error('apply_timeout')), 15_000);
          const onMessage = (ev: MessageEvent): void => {
            let frame: { type?: string; error?: string; cid?: string; applied?: unknown[] };
            try {
              frame = JSON.parse(String(ev.data));
            } catch {
              return;
            }
            if (frame.type === 'ops') {
              applied.push(...(frame.applied ?? []));
              clearTimeout(timer);
              socket.removeEventListener('message', onMessage);
              resolve({ applied, dropped });
            }
            if (frame.type === 'error') {
              if (frame.error === 'op_dropped' && frame.cid) dropped.push(frame.cid);
              clearTimeout(timer);
              socket.removeEventListener('message', onMessage);
              resolve({ applied, dropped });
            }
          };
          socket.addEventListener('message', onMessage);
          socket.send(JSON.stringify({ type: 'ops', ops: opsToSend }));
        }),
      ops as unknown as object[],
    )) as { applied: AppliedOp[]; dropped: string[] };
  }

  async close(): Promise<void> {
    await this.page.evaluate(() => {
      const socket = (window as unknown as { __liveAlbumSocket?: WebSocket }).__liveAlbumSocket;
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
    });
  }
}

/** Connect as the seeded root identity (the all-zero uuid). */
export async function connectRoot(page: Page): Promise<{
  album: LiveAlbum;
  welcome: LiveWelcome;
}> {
  return LiveAlbum.connect(page, { uuid: '00000000-0000-0000-0000-000000000000' });
}

/** Connect as a fresh visitor (the e2e Worker runs on Turnstile's published test keys). */
export async function connectVisitor(
  page: Page,
  turnstileToken = 'e2e-token',
): Promise<{ album: LiveAlbum; welcome: LiveWelcome }> {
  return LiveAlbum.connect(page, { turnstileToken });
}

/** Convenience: install the worker, mock the socket, and assert the socket was dialed. */
export async function mountAlbum(page: Page, options: MockAlbumOptions = {}): Promise<AlbumSocket> {
  await installSyncWorker(page);
  return mockAlbumSocket(page, options);
}

/** Wait until the page has actually dialed `/ws` and sent its hello. */
export async function expectConnected(album: AlbumSocket): Promise<void> {
  await expect.poll(() => album.received.some((f) => f.type === 'hello')).toBe(true);
}
