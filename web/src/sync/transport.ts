// The tab-side handle on the sync coordinator. The engine talks to this, never to the
// socket directly: one browser, one connection, shared across tabs (ADR 0026 §8).
// Production wires a SharedWorker port; tests inject an in-memory implementation.

import type { AppliedOp, WsServerFrame } from '$shared/types';

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

export type { AppliedOp };

/** Production transport: a SharedWorker running sync/worker.ts. */
export function sharedWorkerTransport(): SyncTransport | null {
  if (typeof SharedWorker === 'undefined') return null;
  const worker = new SharedWorker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'infoto-sync',
  });
  const port = worker.port;
  port.start();
  return portTransport(port);
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
