// /ws client — one WebSocket per page. The engine owns when to connect and what to
// send; this wrapper owns only the socket lifecycle and JSON frame plumbing. There is
// deliberately no automatic reconnection: a broken connection is retried by the visible
// sync button, never in the background (ADR 0026).

import type { WsClientFrame, WsServerFrame } from '$shared/types';

/** Minimal socket surface the engine needs; tests inject a fake. */
export interface WsSocket {
  close(): void;
  send(data: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
}

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface WsClientIo {
  /** Socket factory; defaults to the browser WebSocket. Tests inject a fake. */
  factory?: (url: string) => WsSocket;
  /** Endpoint override (tests). Default: the same-origin /ws with the ws(s) scheme. */
  url?: string;
  onOpen?: () => void;
  onClose?: () => void;
  /** Transport failure, including a connection that never opened. */
  onError?: (e: unknown) => void;
  onFrame?: (frame: WsServerFrame) => void;
}

/** Same-origin /ws endpoint; http(s) maps to ws(s). */
export function wsUrl(origin: string = location.origin): string {
  return `${origin.replace(/^http/, 'ws')}/ws`;
}

export class WsClient {
  private socket: WsSocket | null = null;
  private status: WsStatus = 'idle';
  private io: WsClientIo;

  constructor(io: WsClientIo = {}) {
    this.io = io;
  }

  /** Adopt new overrides (a remounted page supplies its own). Only keys the caller
   *  actually defines are replaced — a rebind without a factory must not strip the one
   *  the constructor injected. */
  rebind(io: WsClientIo): void {
    if (io.factory !== undefined) this.io.factory = io.factory;
    if (io.url !== undefined) this.io.url = io.url;
  }

  get connected(): boolean {
    return this.status === 'open';
  }

  get state(): WsStatus {
    return this.status;
  }

  connect(): void {
    if (this.status === 'open' || this.status === 'connecting') return;
    this.status = 'connecting';
    let socket: WsSocket;
    try {
      // The default endpoint is only resolved when the browser socket is used; a factory
      // (tests) may run where `location` does not exist.
      socket = this.io.factory
        ? this.io.factory(this.io.url ?? '')
        : (new WebSocket(this.io.url ?? wsUrl()) as unknown as WsSocket);
    } catch (e) {
      this.status = 'closed';
      this.io.onError?.(e);
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.status = 'open';
      this.io.onOpen?.();
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasOpen = this.status === 'open';
      this.status = 'closed';
      if (wasOpen) this.io.onClose?.();
      else this.io.onError?.(new Error('websocket_connect_failed'));
    });
    socket.addEventListener('error', () => {
      // The close event always follows an error; one path handles the failure.
    });
    socket.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let frame: WsServerFrame;
      try {
        frame = JSON.parse(ev.data) as WsServerFrame;
      } catch {
        return;
      }
      if (!frame || typeof frame.type !== 'string') return;
      this.io.onFrame?.(frame);
    });
  }

  /** Send one frame; false when the socket is not open or the send threw. */
  send(frame: WsClientFrame): boolean {
    if (this.status !== 'open' || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.status = 'closed';
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }
}
