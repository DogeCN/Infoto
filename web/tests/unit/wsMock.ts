// Test doubles for the /ws transport: a scripted socket plus two ready-made factories —
// an auto-server that welcomes the client and answers every sync frame with a snapshot,
// and a dead socket that closes before it ever opens (the offline case).

import type { Op, SyncResponse, WsServerFrame } from '$shared/types';

/** The map's storage type; emit hands every listener the event it registered for. */
type AnyListener = (ev?: unknown) => void;

export class FakeWebSocket {
  readonly url: string;
  readyState = 0;
  /** Every frame the client sent, parsed. */
  sent: Array<Record<string, unknown> & { type: string }> = [];
  /** Scripted server behavior, invoked with every frame the client sends. */
  onSend: ((frame: Record<string, unknown> & { type: string }) => void) | null = null;
  private listeners = new Map<string, AnyListener[]>();

  constructor(url: string) {
    this.url = url;
  }

  // The two overloads mirror the WsSocket interface, so a FakeWebSocket is structurally
  // a WsSocket without a cast. The implementation signature's `never` parameter accepts
  // both overloads' listener shapes; dispatch casts back to the storage type.
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: string, listener: (ev: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as AnyListener]);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown> & { type: string };
    this.sent.push(frame);
    this.onSend?.(frame);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  /** Test side: the scripted server completes the handshake. */
  serverOpen(): void {
    this.readyState = 1;
    this.emit('open');
  }

  /** Test side: the scripted server delivers a frame to the client. */
  serverSend(frame: WsServerFrame): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  private emit(type: string, ev?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as AnyListener)(ev);
  }
}

export interface WsStub {
  /** Every socket the factory created, in creation order. */
  sockets: FakeWebSocket[];
  /** Every client frame, flattened across sockets. */
  frames: Array<Record<string, unknown> & { type: string }>;
}

/** A socket the server never accepts: the offline case. */
export function deadSocketFactory(): (url: string) => FakeWebSocket {
  return (url) => {
    const ws = new FakeWebSocket(url);
    // Deferred so the client's listeners are attached before the close lands.
    setTimeout(() => ws.close(), 0);
    return ws;
  };
}

/** A socket whose scripted server welcomes the client and answers every sync frame with
 *  the given snapshot — or one computed from the frame's own ops. */
export function autoServer(
  response: SyncResponse | ((ops: Op[]) => SyncResponse),
  opts: { selfId?: number } = {},
): WsStub & { factory: (url: string) => FakeWebSocket } {
  const sockets: FakeWebSocket[] = [];
  const frames: Array<Record<string, unknown> & { type: string }> = [];
  const factory = (url: string) => {
    const ws = new FakeWebSocket(url);
    sockets.push(ws);
    ws.onSend = (frame) => {
      frames.push(frame);
      if (frame.type === 'hello') {
        ws.serverSend({
          type: 'welcome',
          selfId: opts.selfId ?? 0,
          uuid: 'uuid-test',
          serverTime: 1,
          mediaHostUrl: 'https://facade.test',
        });
      }
      if (frame.type === 'sync') {
        const res = typeof response === 'function' ? response((frame.ops ?? []) as Op[]) : response;
        ws.serverSend({ type: 'synced', response: res });
      }
    };
    // Deferred so the client's listeners are attached before the open lands.
    setTimeout(() => ws.serverOpen(), 0);
    return ws;
  };
  return { factory, sockets, frames };
}
