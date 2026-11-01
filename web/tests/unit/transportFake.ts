// Test doubles for the sync transport: a scripted SyncTransport the engine can drive,
// plus the handles the test uses to play server frames, connection state, and drop
// notices at it.

import type { AppliedOp, Op, WsClientFrame, WsServerFrame } from '$shared/types';
import type { SyncTransport } from '../../src/sync/transport';

export class FakeTransport implements SyncTransport {
  /** Every client frame the engine asked the transport to carry. */
  sent: WsClientFrame[] = [];
  tokens: string[] = [];
  initCalls = 0;
  connectCalls = 0;
  flushCalls = 0;
  connected = false;

  private frameCbs = new Set<(frame: WsServerFrame) => void>();
  private dropCbs = new Set<(cid: string) => void>();
  private stateCbs = new Set<
    (s: { connected: boolean; syncing: boolean; pending: number }) => void
  >();

  init(): void {
    this.initCalls++;
  }
  connect(): void {
    this.connectCalls++;
  }
  verify(token: string): void {
    this.tokens.push(token);
  }
  queued(): void {
    /* the test drives state directly */
  }
  flush(): void {
    this.flushCalls++;
  }
  onFrame(cb: (frame: WsServerFrame) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }
  onDropped(cb: (cid: string) => void): () => void {
    this.dropCbs.add(cb);
    return () => this.dropCbs.delete(cb);
  }
  onState(cb: (s: { connected: boolean; syncing: boolean; pending: number }) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  // ---------- test side ----------

  /** Play one server frame at the engine. */
  serverSend(frame: WsServerFrame): void {
    for (const cb of this.frameCbs) cb(frame);
  }

  /** Play a connection-state change at the engine. */
  setState(connected: boolean, pending = 0, syncing = false): void {
    this.connected = connected;
    const s = { connected, syncing, pending };
    for (const cb of this.stateCbs) cb(s);
  }

  /** Play a drop notice at the engine. */
  serverDrop(cid: string): void {
    for (const cb of this.dropCbs) cb(cid);
  }

  /** The ops frames the engine queued (the coordinator owns real sends; this fake
   *  records nothing for them — queue inspection goes through the oplog). */
  sentOpsFrames(): number {
    return this.sent.filter((f) => f.type === 'ops').length;
  }

  sentHellos(): Array<Extract<WsClientFrame, { type: 'hello' }>> {
    return this.sent.filter(
      (f): f is Extract<WsClientFrame, { type: 'hello' }> => f.type === 'hello',
    );
  }
}

/** Build an applied op as the server would broadcast it — the echo carries the op's
 *  nonce at the AppliedOp level, hoisted from the op itself. */
export const applied = (seq: number, op: Op, actor = 1): AppliedOp => ({
  seq,
  op,
  actor,
  ts: 1_000,
  ...(op.cid ? { cid: op.cid } : {}),
});
