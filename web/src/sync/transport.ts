// The tab-side handle on the sync coordinator. The engine talks to this, never to the
// socket directly: one browser, one connection, shared across tabs (ADR 0026).
// Production wires a SharedWorker port, with an in-page fallback where one is unavailable;
// tests inject an in-memory implementation.

import type { WsServerFrame } from '$shared/types';
import {
  attachCoordinatorPort,
  CoordinatorCore,
  type CoordinatorMessage,
  type TabMessage,
} from './coordinator';

export interface SyncTransport {
  /** Tab registration: recounts the queue and (re)opens the connection. */
  init(): void;
  /** The sync button: retry a connection that is not open. */
  connect(): void;
  /** Ride a Turnstile token on the next hello. */
  verify(token: string): void;
  /** An op was appended to the shared queue; the coordinator recounts and flushes. */
  queued(): void;
  /** Page exit: flush immediately. */
  flush(): void;
  onFrame(cb: (frame: WsServerFrame) => void): () => void;
  onDropped(cb: (cid: string) => void): () => void;
  onState(
    cb: (state: { connected: boolean; syncing: boolean; pending: number }) => void,
  ): () => void;
}

/** What attachCoordinatorPort accepts: a tab-side port, real or loopback. */
type TabPort = Parameters<typeof attachCoordinatorPort>[1];

/** Production transport: a SharedWorker running sync/worker.ts; null when unavailable. */
export function sharedWorkerTransport(): SyncTransport | null {
  if (typeof SharedWorker === 'undefined') return null;
  let worker: SharedWorker;
  try {
    // Some browsers throw on construction (private mode) rather than abstaining.
    worker = new SharedWorker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'infoto-sync',
    });
  } catch {
    return null;
  }
  const port = worker.port;
  port.start();
  return portTransport(port);
}

/** Overrides for the in-page fallback only; the SharedWorker path takes none. */
export interface InPageTransportIo {
  wsFactory?: (url: string) => import('../core/api/wsClient').WsSocket;
  wsUrl?: string;
  db?: IDBDatabase;
}

/**
 * The no-SharedWorker fallback: the same CoordinatorCore runs in this page, wired to the
 * engine through a same-realm loopback port pair. Safari on iOS does not ship SharedWorker,
 * so without this the page would queue forever and never sync. One socket per tab; the DO
 * keeps only the newest connection of a user, and a replaced tab drops to the offline state
 * where its sync button reconnects it in turn — the dedup rule working as designed (ADR 0026).
 */
export function inPageTransport(io: InPageTransportIo = {}): SyncTransport {
  const [tabSide, coreSide] = loopbackPortPair();
  const core = new CoordinatorCore({
    wsFactory: io.wsFactory,
    wsUrl: io.wsUrl,
    db: io.db,
    onFrame: (frame) => coreSide.postMessage({ kind: 'frame', frame }),
    onState: (state) => coreSide.postMessage({ kind: 'state', ...state }),
    onDropped: (cid) => coreSide.postMessage({ kind: 'dropped', cid }),
  });
  attachCoordinatorPort(core, coreSide);
  return portTransport(tabSide);
}

interface MessagePortLike<M, N> {
  addEventListener(type: 'message', listener: (ev: { data: M }) => void): void;
  postMessage(message: N): void;
}

/** Both ends of a same-realm message pipe; delivery is async like a real port. */
function loopbackPortPair(): [MessagePortLike<CoordinatorMessage, TabMessage>, TabPort] {
  const toTab = new Set<(ev: { data: CoordinatorMessage }) => void>();
  const toCore = new Set<(ev: { data: TabMessage }) => void>();
  return [
    {
      addEventListener: (_type, listener) => toTab.add(listener),
      postMessage: (message) => {
        queueMicrotask(() => {
          for (const listener of [...toCore]) listener({ data: message });
        });
      },
    },
    {
      addEventListener: (_type, listener) => toCore.add(listener),
      postMessage: (message) => {
        queueMicrotask(() => {
          for (const listener of [...toTab]) listener({ data: message });
        });
      },
      start: () => {
        /* same-realm loopback has no start gate */
      },
    },
  ];
}

/** Wrap a SharedWorker port (or any message port speaking the coordinator protocol). */
export function portTransport(port: {
  addEventListener: (
    type: 'message',
    l: (ev: { data: import('./coordinator').CoordinatorMessage }) => void,
  ) => void;
  postMessage: (message: import('./coordinator').TabMessage) => void;
}): SyncTransport {
  const frames = new Set<(frame: WsServerFrame) => void>();
  const drops = new Set<(cid: string) => void>();
  const states = new Set<(s: { connected: boolean; syncing: boolean; pending: number }) => void>();
  port.addEventListener('message', (ev) => {
    const message = ev.data;
    switch (message.kind) {
      case 'frame':
        for (const cb of frames) cb(message.frame);
        return;
      case 'dropped':
        for (const cb of drops) cb(message.cid);
        return;
      case 'state':
        for (const cb of states) cb(message);
        return;
    }
  });
  return {
    init: () => port.postMessage({ kind: 'init' }),
    connect: () => port.postMessage({ kind: 'connect' }),
    verify: (token) => port.postMessage({ kind: 'verify', token }),
    queued: () => port.postMessage({ kind: 'queued' }),
    flush: () => port.postMessage({ kind: 'flush' }),
    onFrame: (cb) => (frames.add(cb), () => frames.delete(cb)),
    onDropped: (cb) => (drops.add(cb), () => drops.delete(cb)),
    onState: (cb) => (states.add(cb), () => states.delete(cb)),
  };
}
