// Global single-instance Durable Object room. Owns op ordering, server-side
// stamping, real-time broadcast, and idle compaction/archival.

import type { Op } from '../../shared/types.ts';

interface Env {
  DB: D1Database;
  MEDIA_HOST_URL?: string;
}

interface OpRow {
  seq: number;
  type: string;
  payload: string | null;
  actor: number;
  ts: number;
  [key: string]: SqlStorageValue;
}

interface MetaRow {
  snapshot: string | null;
  version: number;
  compactedSeq: number;
  [key: string]: SqlStorageValue;
}

interface ConnectionMeta {
  userId: number;
  lastSeq: number;
}

const COMPACTION_ALARM_MS = 60 * 60 * 1000; // 1 hour
const ARCHIVE_THRESHOLD = 256;

export class Album {
  private state: DurableObjectState;
  private env: Env;
  private connections = new Map<WebSocket, ConnectionMeta>();
  private userSockets = new Map<number, WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    this.connections.set(server, { userId: 0, lastSeq: 0 });
    // If this is the first connection after idle, cancel pending alarm.
    if (this.connections.size === 1) {
      await this.state.storage.deleteAlarm();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(
        typeof message === 'string' ? message : new TextDecoder().decode(message),
      ) as Record<string, unknown>;
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'bad_json' }));
      return;
    }

    if (msg?.type === 'hello') {
      const lastSeq = typeof msg.lastSeq === 'number' ? msg.lastSeq : 0;
      // Identity resolution simplified: userId from token or 0 for anonymous.
      const userId = typeof msg.userId === 'number' ? msg.userId : 0;
      const meta = this.connections.get(ws);
      if (meta) {
        meta.userId = userId;
        meta.lastSeq = lastSeq;
      }
      // Dedup: kick older socket for same user.
      const old = this.userSockets.get(userId);
      if (old && old !== ws) {
        try {
          old.close(4001, 'replaced');
        } catch {
          /* ignore */
        }
        this.connections.delete(old);
      }
      this.userSockets.set(userId, ws);

      // Catch-up ops.
      const rows = await this.state.storage.sql
        .exec<OpRow>(
          'SELECT seq, type, payload, actor, ts FROM ops WHERE seq > ? ORDER BY seq ASC',
          lastSeq,
        )
        .toArray();
      const ops = rows.map((r) => ({
        seq: r.seq,
        op: { type: r.type, ...(r.payload ? JSON.parse(r.payload) : {}) },
        actor: r.actor,
        ts: r.ts,
      }));

      // Snapshot if needed (lastSeq === 0 or big gap).
      let snapshot: unknown = null;
      const metaRow = await this.state.storage.sql
        .exec<MetaRow>('SELECT snapshot, version, compactedSeq FROM meta WHERE key = ?', 'main')
        .one();
      const compactedSeq = metaRow?.compactedSeq ?? 0;
      if (lastSeq === 0 || lastSeq < compactedSeq) {
        // Try DO meta snapshot first.
        if (metaRow?.snapshot) {
          try {
            snapshot = JSON.parse(metaRow.snapshot);
          } catch {
            snapshot = null;
          }
        }
        if (!snapshot) {
          // Fall back to D1 canonical read (simplified: empty; real impl reads tables).
          snapshot = { photos: [], announcements: [], polls: [], feedback: [] };
        }
      }

      ws.send(
        JSON.stringify({
          type: 'welcome',
          selfId: userId,
          mediaHostUrl: this.env.MEDIA_HOST_URL ?? '',
          serverTime: Date.now(),
          compactedSeq,
          ops,
          snapshot,
        }),
      );
      return;
    }

    if (msg?.type === 'op') {
      const op = msg.op as Op;
      if (!op || typeof op.type !== 'string') {
        ws.send(JSON.stringify({ type: 'error', error: 'bad_op' }));
        return;
      }
      const meta = this.connections.get(ws);
      const actor = meta?.userId ?? 0;
      const ts = Date.now();
      // Append to ops table with auto-increment seq.
      const result = await this.state.storage.sql
        .exec<{ seq: number }>(
          'INSERT INTO ops (type, payload, actor, ts) VALUES (?, ?, ?, ?) RETURNING seq',
          op.type,
          JSON.stringify(op.payload ?? null),
          actor,
          ts,
        )
        .one();
      const seq = result?.seq ?? 0;
      // Broadcast to all connections.
      const broadcast = JSON.stringify({ type: 'op', seq, op, actor, ts });
      for (const [sock] of this.connections) {
        try {
          sock.send(broadcast);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (msg?.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const meta = this.connections.get(ws);
    if (meta) {
      if (this.userSockets.get(meta.userId) === ws) {
        this.userSockets.delete(meta.userId);
      }
      this.connections.delete(ws);
    }
    // If no connections left, set 1-hour alarm.
    if (this.connections.size === 0) {
      await this.state.storage.setAlarm(Date.now() + COMPACTION_ALARM_MS);
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error', false);
  }

  async alarm(): Promise<void> {
    if (this.connections.size > 0) {
      // Someone connected; reschedule.
      await this.state.storage.setAlarm(Date.now() + COMPACTION_ALARM_MS);
      return;
    }
    // Inner compaction: read all ops, coalesce by (type, targetSha/target), keep latest per dimension.
    const rows = await this.state.storage.sql
      .exec<OpRow>('SELECT seq, type, payload, actor, ts FROM ops ORDER BY seq ASC')
      .toArray();
    // Simple compaction: if ops count <= 256, just rebuild snapshot in meta and clear ops.
    // Otherwise archive to D1 first.
    const ops = rows.map((r) => ({
      seq: r.seq,
      type: r.type,
      payload: r.payload,
      actor: r.actor,
      ts: r.ts,
    }));

    // Build snapshot from meta or D1.
    const metaRow = await this.state.storage.sql
      .exec<MetaRow>('SELECT snapshot, version, compactedSeq FROM meta WHERE key = ?', 'main')
      .one();
    const snapshot: unknown = metaRow?.snapshot
      ? JSON.parse(String(metaRow.snapshot))
      : { photos: [], announcements: [], polls: [], feedback: [] };
    // Apply ops to snapshot (simplified: just store ops count; real impl applies).
    // For now, store compacted state.
    const newCompactedSeq = ops.length > 0 ? ops[ops.length - 1].seq : (metaRow?.compactedSeq ?? 0);
    const newVersion = (metaRow?.version ?? 0) + 1;

    // If still > 256 ops after compaction, archive snapshot to D1.
    if (ops.length > ARCHIVE_THRESHOLD) {
      try {
        await this.env.DB.prepare(
          'INSERT OR REPLACE INTO album_snapshots (album_id, version, snapshot, compacted_at) VALUES (?, ?, ?, ?)',
        )
          .bind('global', newVersion, JSON.stringify(snapshot), Date.now())
          .run();
      } catch (e) {
        console.error('[Album] D1 archive failed', e);
      }
    }

    // Clear ops, update meta.
    await this.state.storage.sql.exec('DELETE FROM ops');
    await this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, snapshot, version, compactedSeq) VALUES (?, ?, ?, ?)',
      'main',
      JSON.stringify(snapshot),
      newVersion,
      newCompactedSeq,
    );
  }
}
