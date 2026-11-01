// /ws Durable Object — the album's single sequential writer (ADR 0026).
//
// The object owns the op log: every write lands here in order, gets a server stamp and a
// dense sequence number, is folded into the in-memory snapshot, and is broadcast to every
// connection in one frame. D1 is the cold snapshot store — written at the edges (an upload
// op immediately, so /l/:id36 links resolve; a flush before a migrate export; the
// compaction alarm) and read only to hydrate a cold object.
//
// One instance exists ("global"); there are no other albums. A new connection of a user
// that already has one replaces it (one device online per account); the replaced client
// drops into the offline state and shows its sync button.
//
// The internal HTTP endpoints (flush / rehydrate / photo lookup) are only reachable
// through the Album binding: the Worker forwards nothing here but WebSocket upgrades.

import type { AlbumSnapshot, AppliedOp, Op, WsServerFrame } from '../../shared/types.ts';
import { MAX_SYNC_OPS } from '../../shared/types.ts';
import {
  applySnapshotOp,
  authorized,
  flushToD1,
  foldOps,
  hydrateSnapshot,
  isOversizedAnnouncementOp,
} from '../album-ops.ts';
import { createUser, resolveUser } from '../identity.ts';
import { d1Db } from '../db-d1.ts';
import { verifyTurnstile } from '../turnstile.ts';
import { fromId36 } from '../../shared/media.ts';

export interface AlbumEnv {
  DB: D1Database;
  MEDIA_HOST_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
}

/** Per-connection session state, serialized so a hibernation wake keeps the identity. */
interface ConnInfo {
  userId: number;
  uuid: string | null;
}

const UNAUTHENTICATED: ConnInfo = { userId: -1, uuid: null };

/** One stored op: the durable row, and the shape catch-up replays. */
interface StoredOp {
  seq: number;
  cid: string | null;
  type: string;
  payload: string | null;
  actor: number;
  ts: number;
  ct: number | null;
  [key: string]: SqlStorageValue;
}

interface MetaRow {
  snapshot: string | null;
  compactedSeq: number;
  [key: string]: SqlStorageValue;
}

/** Ops beyond this count after log-level compaction are folded into the snapshot and
 *  archived to D1 (spec §5). */
const ARCHIVE_THRESHOLD = 256;
/** Idle compaction alarm: set when the last connection leaves, cleared when one arrives. */
const COMPACTION_ALARM_MS = 60 * 60 * 1000;

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
  /** The in-memory snapshot, lazily rebuilt from meta + stored ops (or hydrated from D1
   *  on a truly cold object). Hibernation keeps the storage; this cache is what dies. */
  private snapshot: AlbumSnapshot | null = null;
  /** Highest applied seq reflected in `snapshot` (in memory). */
  private loadedSeq = 0;
  private loaded = false;

  constructor(
    private state: DurableObjectState,
    private env: AlbumEnv,
  ) {}

  // ---------- storage ----------

  private async ensureSchema(): Promise<void> {
    await this.state.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS ops (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         cid TEXT, type TEXT NOT NULL, payload TEXT, actor INTEGER NOT NULL,
         ts INTEGER NOT NULL, ct INTEGER)`,
    );
    await this.state.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS meta (
         key TEXT PRIMARY KEY, snapshot TEXT, compactedSeq INTEGER NOT NULL DEFAULT 0)`,
    );
  }

  private async readMeta(): Promise<{ snapshot: AlbumSnapshot | null; compactedSeq: number }> {
    // `.toArray()` rather than `.one()`: a cold object has no meta row yet, and `.one()`
    // throws when the query returns nothing instead of yielding null.
    const rows = await this.state.storage.sql
      .exec<MetaRow>('SELECT snapshot, compactedSeq FROM meta WHERE key = ?', 'main')
      .toArray();
    const row = rows[0];
    if (!row || row.snapshot === null || row.snapshot === undefined) {
      return { snapshot: null, compactedSeq: 0 };
    }
    try {
      return {
        snapshot: JSON.parse(String(row.snapshot)) as AlbumSnapshot,
        compactedSeq: Number(row.compactedSeq),
      };
    } catch {
      return { snapshot: null, compactedSeq: 0 };
    }
  }

  private async writeMeta(snapshot: AlbumSnapshot, compactedSeq: number): Promise<void> {
    await this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, snapshot, compactedSeq) VALUES (?, ?, ?)',
      'main',
      JSON.stringify(snapshot),
      compactedSeq,
    );
  }

  private async readStoredOps(): Promise<StoredOp[]> {
    const rows = await this.state.storage.sql
      .exec<StoredOp>('SELECT seq, cid, type, payload, actor, ts, ct FROM ops ORDER BY seq ASC')
      .toArray();
    return rows.map((r) => ({
      seq: Number(r.seq),
      cid: r.cid === null ? null : String(r.cid),
      type: String(r.type),
      payload: r.payload === null ? null : String(r.payload),
      actor: Number(r.actor),
      ts: Number(r.ts),
      ct: r.ct === null || r.ct === undefined ? null : Number(r.ct),
    }));
  }

  private toApplied(row: StoredOp): AppliedOp {
    // The stored JSON is the whole op (the payload column holds it, stamp included).
    return {
      seq: row.seq,
      op: (row.payload ? JSON.parse(row.payload) : { type: row.type }) as Op,
      actor: row.actor,
      ts: row.ts,
      ...(row.cid ? { cid: row.cid } : {}),
    };
  }

  /** Bring the in-memory snapshot up to the latest stored seq. Cheap after the first
   *  call: replays at most the ops since the last compaction. */
  private async ensureLoaded(): Promise<AlbumSnapshot> {
    if (this.loaded && this.snapshot) return this.snapshot;
    await this.ensureSchema();
    const meta = await this.readMeta();
    const stored = await this.readStoredOps();
    if (meta.snapshot) {
      this.snapshot = meta.snapshot;
      this.loadedSeq = meta.compactedSeq;
      // A cold object replays the durable log onto the persisted snapshot.
      for (const row of stored) {
        if (row.seq <= this.loadedSeq) continue;
        const applied = this.toApplied(row);
        try {
          applySnapshotOp(this.snapshot, { id: applied.actor }, applied.op, applied.ts, {
            mediaHostUrl: this.env.MEDIA_HOST_URL,
          });
          this.loadedSeq = applied.seq;
        } catch (e) {
          console.error('[album] replay failed', row.type, e);
        }
      }
    } else {
      // Truly cold: hydrate the snapshot from D1, then replay anything logged after it.
      this.snapshot = await hydrateSnapshot(d1Db(this.env.DB));
      this.loadedSeq = meta.compactedSeq;
      for (const row of stored) {
        if (row.seq <= this.loadedSeq) continue;
        const applied = this.toApplied(row);
        try {
          applySnapshotOp(this.snapshot, { id: applied.actor }, applied.op, applied.ts, {
            mediaHostUrl: this.env.MEDIA_HOST_URL,
          });
          this.loadedSeq = applied.seq;
        } catch (e) {
          console.error('[album] replay failed', row.type, e);
        }
      }
      await this.writeMeta(this.snapshot, Math.max(meta.compactedSeq, this.loadedSeq));
    }
    this.loaded = true;
    return this.snapshot;
  }

  private async maxSeq(): Promise<number> {
    const row = await this.state.storage.sql
      .exec<{ seq: number }>('SELECT COALESCE(MAX(seq), 0) AS seq FROM ops')
      .one();
    return Number(row?.seq ?? 0);
  }

  // ---------- WebSocket surface ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Internal endpoints: reachable only through the Album binding (the Worker forwards
    // nothing here but WebSocket upgrades), so no extra auth is needed.
    if (url.pathname === '/internal/flush') {
      await this.flush();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/internal/rehydrate') {
      await this.ensureSchema();
      await this.state.storage.sql.exec('DELETE FROM ops');
      await this.state.storage.sql.exec("DELETE FROM meta WHERE key = 'main'");
      this.snapshot = null;
      this.loadedSeq = 0;
      this.loaded = false;
      return new Response(null, { status: 204 });
    }
    const photoMatch = url.pathname.match(/^\/internal\/photo\/([a-z0-9]+)$/);
    if (photoMatch) {
      const id = fromId36(photoMatch[1]!);
      const snap = id === null ? null : await this.ensureLoaded();
      const photo = id === null || !snap ? null : snap.photos.find((p) => p.id === id);
      if (!photo) return new Response(JSON.stringify({ found: false }), { status: 404 });
      return new Response(JSON.stringify({ found: true, url: photo.url, type: photo.type }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    // The uuid cookie rides the handshake; a returning visitor is resolved before hello
    // and the HttpOnly cookie is re-issued here — the sliding window the sync write used to own.
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
        case 'ops':
          await this.ingest(ws, frame);
          return;
        case 'ping':
          this.send(ws, { type: 'pong' });
          return;
        default:
          this.send(ws, { type: 'error', error: 'bad_request' });
      }
    } catch (e) {
      console.error('[album] frame failed', frame.type, e);
      this.send(ws, { type: 'error', error: 'internal' });
    }
  }

  /** Authenticate, replace any older connection of the same user, and catch the client
   *  up: incremental ops after its lastSeq, or a whole snapshot when it has none (or the
   *  gap reaches behind the retained window). */
  private async hello(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const known = connInfo(ws);
    let info = known;
    if (known.userId < 0) {
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
      info = { userId: user.id, uuid: user.uuid };
    }
    // One connection per user: a newer one replaces the older, which drops into the
    // offline state (its sync button is the way back).
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const otherInfo = connInfo(other);
      if (otherInfo.userId === info.userId) {
        try {
          other.close(4001, 'replaced');
        } catch {
          /* already closing */
        }
      }
    }
    ws.serializeAttachment(info);

    const snap = await this.ensureLoaded();
    const lastSeqRaw = frame.lastSeq;
    const lastSeq =
      typeof lastSeqRaw === 'number' && Number.isSafeInteger(lastSeqRaw) && lastSeqRaw >= 0
        ? lastSeqRaw
        : 0;
    const compacted = await this.readMeta();
    const maxSeq = await this.maxSeq();
    // Behind the retained window (or fresh): the whole snapshot. A client that claims a
    // seq this object has never issued (a migrate import reset the log beneath it, or a
    // stale localStorage value) is further ahead than the server can explain, so its
    // whole view is stale: it gets the snapshot too, never a silently empty increment.
    const fullSnapshot = lastSeq === 0 || lastSeq < compacted.compactedSeq || lastSeq > maxSeq;
    const filteredOps = fullSnapshot
      ? []
      : (await this.readStoredOps())
          .filter((row) => row.seq > lastSeq)
          .map((row) => this.toApplied(row))
          .filter((applied) => info.userId === 0 || !applied.op.type.startsWith('fb_'));
    this.send(ws, {
      type: 'welcome',
      selfId: info.userId,
      uuid: info.uuid ?? '',
      mediaHostUrl: this.env.MEDIA_HOST_URL ?? '',
      seq: maxSeq,
      ...(fullSnapshot
        ? {
            snapshot: {
              ...snap,
              feedback: info.userId === 0 ? snap.feedback : [],
            },
            // Ops logged after the snapshot was last persisted ride along.
            ops: filteredOps,
          }
        : { ops: filteredOps }),
    });
    // A connection exists again — the idle compaction alarm stands down.
    await this.state.storage.deleteAlarm();
  }

  /** Ingest one ops frame: server-stamp, fold into the snapshot, persist each op, and
   *  broadcast the whole batch once. Upload ops also upsert D1 immediately so /l/ links
   *  resolve before any compaction. */
  private async ingest(ws: WebSocket, frame: Record<string, unknown>): Promise<void> {
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
    const snap = await this.ensureLoaded();
    const applied: AppliedOp[] = [];
    for (const raw of ops) {
      const op = raw as Op;
      const cid = typeof op?.cid === 'string' && op.cid ? op.cid : null;
      // An op this actor may never apply is refused before the log: it is neither stored
      // nor broadcast, and the owning client rolls its optimistic state back. Storing it
      // would let the next archive write it into D1 (a non-root delete is a real DELETE).
      // The same applies to an announcement too long to store: the write limits answer it.
      if (!authorized(op, info.userId) || isOversizedAnnouncementOp(op)) {
        this.send(ws, { type: 'error', error: 'op_dropped', ...(cid ? { cid } : {}) });
        continue;
      }
      const ts = Date.now();
      if (cid) {
        // Idempotent ingest: a backlog re-sent after a lost ack applies once. `.toArray()`
        // because `.one()` throws when this cid has not been seen yet — the common case.
        const seen = await this.state.storage.sql
          .exec<{ seq: number }>('SELECT seq FROM ops WHERE cid = ?', cid)
          .toArray();
        if (seen.length > 0) continue;
      }
      let changed = false;
      try {
        changed = applySnapshotOp(snap, { id: info.userId }, op, ts, {
          mediaHostUrl: this.env.MEDIA_HOST_URL,
        });
      } catch (e) {
        console.error('[album] op dropped', op?.type, e);
      }
      // The WHOLE op is persisted (type, target/targetSha, payload, cid, ct): marks and
      // reactions carry their target at the op level, and the replay must see it.
      const result = await this.state.storage.sql
        .exec<{ seq: number }>(
          'INSERT INTO ops (cid, type, payload, actor, ts, ct) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq',
          cid,
          String(op?.type ?? ''),
          JSON.stringify(op),
          info.userId,
          ts,
          typeof op?.ct === 'number' ? op.ct : null,
        )
        .one();
      const seq = Number(result?.seq ?? 0);
      applied.push({
        seq,
        op: { ...op, type: String(op?.type ?? '') } as Op,
        actor: info.userId,
        ts,
        ...(cid ? { cid } : {}),
      });
      void changed;
    }
    if (applied.length === 0) return;

    // One frame for the whole batch, to every connection. Feedback ops stay root-only.
    // The hot path never writes D1 — /l/:id36 resolves through this object (the media
    // proxy queries it before D1), and compaction archives everything in due time.
    const broadcast = JSON.stringify({
      type: 'ops',
      applied,
    } satisfies WsServerFrame);
    for (const socket of this.state.getWebSockets()) {
      const viewer = connInfo(socket);
      if (viewer.userId === 0) {
        try {
          socket.send(broadcast);
        } catch {
          /* a closing socket drops the frame */
        }
      } else {
        const filtered = applied.filter((a) => !a.op.type.startsWith('fb_'));
        if (filtered.length > 0) {
          try {
            socket.send(JSON.stringify({ type: 'ops', applied: filtered } satisfies WsServerFrame));
          } catch {
            /* a closing socket drops the frame */
          }
        }
      }
    }
  }

  // ---------- compaction, archiving, flushing ----------

  /** Apply every stored op to D1 and fold the log away: D1 becomes exactly current, the
   *  meta snapshot moves to the latest seq, and catch-up past this point is a snapshot. */
  private async flush(): Promise<void> {
    await this.ensureSchema();
    const snap = await this.ensureLoaded();
    const stored = await this.readStoredOps();
    const applied = stored.map((row) => this.toApplied(row));
    await flushToD1(d1Db(this.env.DB), snap, applied);
    const maxSeq = applied.length > 0 ? applied[applied.length - 1]!.seq : await this.maxSeq();
    await this.writeMeta(snap, maxSeq);
    await this.state.storage.sql.exec('DELETE FROM ops');
  }

  /** The idle alarm: fold the log, and archive to D1 only when the folded log still
   *  exceeds the threshold. Any connection in the meantime reschedules. */
  async alarm(): Promise<void> {
    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + COMPACTION_ALARM_MS);
      return;
    }
    await this.ensureSchema();
    const stored = await this.readStoredOps();
    const kept = foldOps(
      stored.map((row) => ({ ...row, op: this.toApplied(row).op, actor: row.actor })),
    );
    const keptSeqs = new Set(kept.map((k) => k.seq));
    for (const row of stored) {
      if (!keptSeqs.has(row.seq)) {
        await this.state.storage.sql.exec('DELETE FROM ops WHERE seq = ?', row.seq);
      }
    }
    const remaining = await this.readStoredOps();
    if (remaining.length > ARCHIVE_THRESHOLD) {
      const snap = await this.ensureLoaded();
      await flushToD1(
        d1Db(this.env.DB),
        snap,
        remaining.map((row) => this.toApplied(row)),
      );
      const maxSeq = remaining.length > 0 ? remaining[remaining.length - 1]!.seq : 0;
      await this.writeMeta(snap, maxSeq);
      await this.state.storage.sql.exec('DELETE FROM ops');
    }
    // Continue idle-waiting: the next alarm folds whatever accumulated since.
    await this.state.storage.setAlarm(Date.now() + COMPACTION_ALARM_MS);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const info = connInfo(ws);
    for (const other of this.state.getWebSockets()) {
      if (connInfo(other).userId === info.userId) return; // a replacement is already live
    }
    if (this.state.getWebSockets().length === 0) {
      await this.state.storage.setAlarm(Date.now() + COMPACTION_ALARM_MS);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private send(ws: WebSocket, frame: WsServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // A socket that is closing drops the frame; the client's queue stays intact.
    }
  }
}
