// /ws Durable Object — the WebSocket endpoint for album sync (ADR 0026).
//
// The object exists because only a Durable Object can hold a WebSocket, and because one room
// is where per-connection session state and any future fan-out belong. It is deliberately
// stateless: identity rows, op application and snapshots all live in D1 through
// `../album-ops.ts`, so a restart or a hibernation wake loses nothing and there is no op
// log to compact. The upgrade request's uuid cookie resolves a returning visitor;
// `hello` only carries a Turnstile token when the visitor has no identity yet.
//
// A `sync` frame is answered to its sender only — there is no cross-client push yet.

import type { Op, SyncResponse, WsServerFrame } from '../../shared/types.ts';
import { MAX_SYNC_OPS } from '../../shared/types.ts';
import { applyOps, snapshot } from '../album-ops.ts';
import { createUser, resolveUser } from '../identity.ts';
import { d1Db } from '../db-d1.ts';
import { verifyTurnstile } from '../turnstile.ts';

export interface AlbumEnv {
  DB: D1Database;
  MEDIA_HOST_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}

/** Per-connection session state, serialized so a hibernation wake keeps the identity. */
interface ConnInfo {
  /** Resolved user id, or -1 until hello authenticates. */
  userId: number;
  uuid: string | null;
}

const UNAUTHENTICATED: ConnInfo = { userId: -1, uuid: null };

/** The connection's session, or unauthenticated when hello has not run. Attachments
 *  survive hibernation, so the Maps a live object would keep are neither needed nor used. */
function connInfo(ws: WebSocket): ConnInfo {
  try {
    const info = ws.deserializeAttachment() as ConnInfo | undefined;
    if (info && typeof info.userId === 'number' && info.userId >= 0) return info;
  } catch {
    // No attachment set yet — hello has not authenticated this socket.
  }
  return UNAUTHENTICATED;
}

export class Album {
  constructor(
    private state: DurableObjectState,
    private env: AlbumEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    // The uuid cookie rides the handshake (same-origin WebSockets carry credentials), so a
    // returning visitor is authenticated before hello and the HttpOnly cookie is re-issued
    // here — the sliding window /sync used to own. A fresh identity is created during hello,
    // after this response is gone; the client mirrors welcome.uuid into a JS-set cookie and
    // the next handshake re-issues it as HttpOnly (ADR 0026).
    const db = d1Db(this.env.DB);
    const user = await resolveUser(db, request.headers.get('cookie'));
    if (user) {
      pair[1].serializeAttachment({ userId: user.id, uuid: user.uuid } satisfies ConnInfo);
      return new Response(null, {
        status: 101,
        webSocket: pair[0],
        headers: {
          'Set-Cookie': `uuid=${encodeURIComponent(user.uuid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000`,
        },
      });
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(
        typeof message === 'string' ? message : new TextDecoder().decode(message),
      ) as Record<string, unknown>;
    } catch {
      this.send(ws, { type: 'error', error: 'bad_json' });
      return;
    }
    try {
      switch (frame.type) {
        case 'hello':
          await this.hello(ws, frame);
          return;
        case 'sync':
          await this.sync(ws, frame);
          return;
        case 'ping':
          this.send(ws, { type: 'pong', serverTime: Date.now() });
          return;
        default:
          this.send(ws, { type: 'error', error: 'bad_request' });
      }
    } catch (e) {
      console.error('[ws] frame failed', frame.type, e);
      this.send(ws, { type: 'error', error: 'internal' });
    }
  }

  /** Authenticate a connection. A cookie-resolved socket re-welcomes; otherwise a
   *  Turnstile token is required and a fresh identity row is created. The socket stays
   *  open on refusal so the retry rides the same connection. */
  private async hello(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const known = connInfo(ws);
    if (known.userId >= 0) {
      this.welcome(ws, known);
      return;
    }
    const token = typeof frame.turnstileToken === 'string' ? frame.turnstileToken : '';
    if (!token) {
      this.send(ws, {
        type: 'error',
        error: 'turnstile_required',
        turnstileSiteKey: this.env.TURNSTILE_SITE_KEY ?? null,
      });
      return;
    }
    const passed = await verifyTurnstile(token, this.env.TURNSTILE_SECRET_KEY);
    if (!passed) {
      this.send(ws, { type: 'error', error: 'turnstile_failed' });
      return;
    }
    const user = await createUser(d1Db(this.env.DB));
    const info: ConnInfo = { userId: user.id, uuid: user.uuid };
    ws.serializeAttachment(info);
    this.welcome(ws, info);
  }

  private welcome(ws: WebSocket, info: ConnInfo): void {
    this.send(ws, {
      type: 'welcome',
      selfId: info.userId,
      uuid: info.uuid ?? '',
      serverTime: Date.now(),
      mediaHostUrl: this.env.MEDIA_HOST_URL ?? '',
    });
  }

  /** Apply one sync frame's ops to D1 in array order, then answer the sender with the
   *  full snapshot — the exact contract POST /sync had, over a frame. */
  private async sync(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const info = connInfo(ws);
    if (info.userId < 0) {
      this.send(ws, { type: 'error', error: 'unauthenticated' });
      return;
    }
    const ops = frame.ops;
    if (!Array.isArray(ops)) {
      this.send(ws, { type: 'error', error: 'bad_request' });
      return;
    }
    if (ops.length > MAX_SYNC_OPS) {
      this.send(ws, { type: 'error', error: 'too_many_ops' });
      return;
    }
    const db = d1Db(this.env.DB);
    const serverTime = Date.now();
    await applyOps(
      { db, mediaHostUrl: this.env.MEDIA_HOST_URL },
      { id: info.userId },
      ops as Op[],
      serverTime,
    );
    const snap = await snapshot(db, info.userId);
    const response: SyncResponse = {
      ok: true,
      serverTime,
      selfId: info.userId,
      mediaHostUrl: this.env.MEDIA_HOST_URL ?? '',
      ...snap,
    };
    this.send(ws, { type: 'synced', response });
  }

  private send(ws: WebSocket, frame: WsServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // A socket that is closing drops the frame; the client's queue stays intact.
    }
  }
}
