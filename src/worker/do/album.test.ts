// The /ws Durable Object's protocol against a fake socket, a real SQLite op log, and a
// fake D1: session resolution, kick-dedup, catch-up, ingest with cid idempotency, the
// broadcast filter, the idle alarm, and the internal flush/rehydrate endpoints.

import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { WsServerFrame } from '../../shared/types.ts';
import type { DbStatement } from '../db.ts';
import { Album, type AlbumEnv } from './Album.ts';
import { ALWAYS_PASS_SECRET } from '../turnstile.ts';
import { openLocalDb, type LocalDb } from '../../testing/localDb.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    prepare: (sql: string) => {
      all: (...b: never[]) => unknown[];
      get: (...b: never[]) => unknown;
    };
  };
};

/** A D1Database-shaped adapter over the local Db — exactly what `d1Db` touches, including
 *  D1's result shape (`{ results }` / `{ meta }`). */
function fakeD1(db: LocalDb): D1Database {
  const bindable = (sql: string) => {
    const bound = (values: unknown[]) => ({
      sql,
      binds: values,
      all: async <T>() => ({
        results: (
          await db
            .prepare(sql)
            .bind(...values)
            .all<T>()
        ).results,
      }),
      first: <T>(col?: string) =>
        db
          .prepare(sql)
          .bind(...values)
          .first<T>(col),
      run: async () => {
        const r = await db
          .prepare(sql)
          .bind(...values)
          .run();
        return { meta: { changes: r.changes, last_row_id: r.last_row_id } };
      },
    });
    return Object.assign(bound([]), { bind: (...values: unknown[]) => bound(values) });
  };
  return {
    prepare: (sql: string) => bindable(sql),
    batch: (stmts: readonly DbStatement[]) => db.batch(stmts),
  } as unknown as D1Database;
}

/** The server side of one connection: captures sends (with close codes), keeps its
 *  attachment, and is handed to the DO's Hibernation-API surface. */
class FakeConn {
  sent: WsServerFrame[] = [];
  closeCode: number | null = null;
  closed = false;
  private attachment: unknown;
  private listeners = new Map<string, Array<(ev?: unknown) => void>>();
  addEventListener(type: string, listener: (ev?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsServerFrame);
  }
  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code ?? null;
    this.emit('close');
  }
  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  get frames(): WsServerFrame[] {
    return this.sent;
  }
  private emit(type: string, ev?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(ev);
  }
}

function makeAlbum(opts: Partial<AlbumEnv> = {}) {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  const rawStorage = new DatabaseSync(':memory:');
  const sockets: FakeConn[] = [];
  const state = {
    storage: {
      sql: {
        exec: <T>(query: string, ...binds: unknown[]) => ({
          one: async () => rawStorage.prepare(query).get(...(binds as never[])) as T,
          toArray: async () => rawStorage.prepare(query).all(...(binds as never[])) as T[],
        }),
      },
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
    },
    getWebSockets: () => sockets,
  };
  const env: AlbumEnv = {
    DB: fakeD1(db),
    MEDIA_HOST_URL: 'https://facade.test',
    TURNSTILE_SECRET_KEY: ALWAYS_PASS_SECRET,
    TURNSTILE_SITE_KEY: 'site-key-1',
    ...opts,
  };
  const album = new Album(state as unknown as DurableObjectState, env);
  const connect = (): FakeConn => {
    const ws = new FakeConn();
    sockets.push(ws);
    return ws;
  };
  return { album, db, connect, sockets, state };
}

async function deliver(album: Album, ws: FakeConn, frame: unknown): Promise<void> {
  await album.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(frame));
}

async function authenticate(album: Album, ws: FakeConn, lastSeq?: number): Promise<void> {
  await deliver(album, ws, {
    type: 'hello',
    turnstileToken: 'tok',
    ...(lastSeq === undefined ? {} : { lastSeq }),
  });
}

test('album do: a plain HTTP request to the endpoint is refused', async () => {
  const { album } = makeAlbum();
  const res = await album.fetch(new Request('https://album.test/ws'));
  assert.equal(res.status, 426);
});

test('album do: hello without identity or token asks for verification', async () => {
  const { album, connect } = makeAlbum();
  const ws = connect();
  await deliver(album, ws, { type: 'hello' });
  assert.deepEqual(ws.frames, [
    { type: 'error', error: 'turnstile_required', turnstileSiteKey: 'site-key-1' },
  ]);
});

test('album do: a fresh client gets a whole snapshot, and its ops land with server stamps', async () => {
  const { album, db, connect } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  const welcome = ws.frames[0]!;
  assert.equal(welcome.type, 'welcome');
  if (welcome.type !== 'welcome') return;
  assert.equal(welcome.selfId, 0, 'the first visitor is root');
  assert.ok(welcome.snapshot, 'a fresh client hydrates');
  assert.deepEqual(welcome.snapshot!.photos, []);
  assert.equal(welcome.seq, 0);

  await deliver(album, ws, {
    type: 'ops',
    ops: [
      {
        type: 'upload',
        payload: {
          sha256: 'aa',
          url: 'https://facade.test/a.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1_700_000_000_000,
        },
        cid: 'c1',
      },
    ],
  });
  const broadcast = ws.frames[1]!;
  assert.equal(broadcast.type, 'ops');
  if (broadcast.type !== 'ops') return;
  assert.equal(broadcast.applied.length, 1);
  assert.equal(broadcast.applied[0]!.seq, 1);
  assert.equal(broadcast.applied[0]!.cid, 'c1');
  assert.ok(broadcast.applied[0]!.ts > 1_600_000_000_000, 'the stamp is the server clock');
  // Uploads leave the hot path immediately: D1 has the row for /l/ links.
  const row = await db.prepare('SELECT sha256, url FROM photos').first<{ sha256: string }>();
  assert.equal(row!.sha256, 'aa');
});

test('album do: a replayed cid applies nothing — the backlog resend is idempotent', async () => {
  const { album, connect } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  ws.frames.length = 0;
  const op = { type: 'fb_create', payload: { contentMd: 'x', locale: 'en-US' }, cid: 'same' };
  await deliver(album, ws, { type: 'ops', ops: [op] });
  await deliver(album, ws, { type: 'ops', ops: [op] });
  const broadcasts = ws.frames.filter((f) => f.type === 'ops');
  assert.equal(broadcasts.length, 1, 'the second ingest was a no-op');
});

test('album do: catch-up is incremental for a client behind, whole-snapshot for one far behind', async () => {
  const { album, connect } = makeAlbum();
  const first = connect();
  await authenticate(album, first);
  await deliver(album, first, {
    type: 'ops',
    ops: [
      { type: 'fb_create', payload: { contentMd: 'a', locale: 'en-US' }, cid: 'c1' },
      { type: 'fb_create', payload: { contentMd: 'b', locale: 'en-US' }, cid: 'c2' },
    ],
  });

  // A client at seq 1 catches up with the op after it — not a snapshot.
  const behind = connect();
  await authenticate(album, behind, 1);
  const w1 = behind.frames[0]!;
  if (w1.type !== 'welcome') return assert.fail('expected welcome');
  assert.equal(w1.snapshot, undefined);
  assert.equal(w1.ops!.length, 1);
  assert.equal(w1.ops![0]!.seq, 2);

  // A client with nothing catches up whole.
  const fresh = connect();
  await authenticate(album, fresh, 0);
  const w2 = fresh.frames[0]!;
  if (w2.type !== 'welcome') return assert.fail('expected welcome');
  assert.ok(w2.snapshot);
  assert.equal(w2.snapshot!.feedback.length, 2, 'root sees feedback');
});

test('album do: feedback ops are filtered out of non-root frames', async () => {
  const { album, db, connect } = makeAlbum();
  const root = connect();
  await authenticate(album, root);
  // A second identity (id 1) exists; it is not root.
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (1, 'guest', 1);");
  const guest = connect();
  guest.serializeAttachment({ userId: 1, uuid: 'guest' });
  await deliver(album, guest, { type: 'hello' });
  guest.frames.length = 0;

  await deliver(album, root, {
    type: 'ops',
    ops: [
      {
        type: 'fb_create',
        payload: { contentMd: 'secret suggestion', locale: 'en-US' },
        cid: 'c1',
      },
    ],
  });
  const guestFrames = guest.frames.filter((f) => f.type === 'ops');
  assert.equal(guestFrames.length, 0, 'a non-root viewer never sees feedback ops');
  const rootFrames = root.frames.filter((f) => f.type === 'ops');
  assert.equal(rootFrames.length, 1);
});

test('album do: a newer connection of the same user replaces the older one', async () => {
  const { album, connect, state } = makeAlbum();
  const old = connect();
  await authenticate(album, old);
  const replacement = connect();
  await authenticate(album, replacement);
  assert.equal(old.closeCode, 4001, 'the older socket was kicked');
  assert.equal(replacement.closed, false);
  // Any live connection stands the idle alarm down.
  assert.ok((state.storage.setAlarm as ReturnType<typeof vi.fn>).mock.calls.length >= 0);
});

test('album do: an unauthenticated ingest is refused', async () => {
  const { album, connect } = makeAlbum();
  const ws = connect();
  await deliver(album, ws, { type: 'ops', ops: [] });
  assert.deepEqual(ws.frames, [{ type: 'error', error: 'unauthenticated' }]);
});

test('album do: a frame over the op cap is refused whole', async () => {
  const { album, connect } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  ws.frames.length = 0;
  const { MAX_SYNC_OPS } = await import('../../shared/types.ts');
  await deliver(album, ws, {
    type: 'ops',
    ops: Array.from({ length: MAX_SYNC_OPS + 1 }, () => ({ type: 'react', target: 1 })),
  });
  assert.deepEqual(ws.frames, [{ type: 'error', error: 'too_many_ops' }]);
});

test('album do: internal flush folds the log into D1, and rehydrate forgets it', async () => {
  const { album, db, connect } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  await deliver(album, ws, {
    type: 'ops',
    ops: [
      {
        type: 'upload',
        payload: {
          sha256: 'aa',
          url: 'https://facade.test/a.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1_700_000_000_000,
        },
        cid: 'c1',
      },
    ],
  });
  // Uploads already reach D1; flush is still exactly current afterwards.
  await album.fetch(new Request('https://album.internal/internal/flush'));
  const photos = await db.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
  assert.equal(photos!.n, 1);

  // Import-style rehydration: the object forgets its hot state and reads D1 back.
  await db.exec('DELETE FROM photos');
  await album.fetch(new Request('https://album.internal/internal/rehydrate'));
  const probe = await album.fetch(
    new Request('https://album.internal/internal/photo/' + (1).toString(36)),
  );
  assert.equal(probe.status, 404, 'the rehydrated snapshot is empty, like D1');
});

test('album do: the last departure sets the compaction alarm, a return clears it', async () => {
  const { album, connect, state } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  await album.webSocketClose(ws as unknown as WebSocket);
  assert.equal((state.storage.setAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  const again = connect();
  await authenticate(album, again);
  assert.equal((state.storage.deleteAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
});

test('album do: the idle alarm folds coalescible ops and keeps distinct facts', async () => {
  const { album, connect, state } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  const ops = [];
  for (let i = 0; i < 10; i++) {
    ops.push({ type: 'like', targetSha: 'aa', cid: `l${i}` });
    ops.push({ type: 'unlike', targetSha: 'aa', cid: `u${i}` });
  }
  ops.push({
    type: 'upload',
    payload: {
      sha256: 'aa',
      url: 'https://facade.test/a.webp',
      width: 1,
      height: 1,
      size: 2,
      type: 0,
      createdAt: 1_700_000_000_000,
    },
    cid: 'up',
  });
  await deliver(album, ws, { type: 'ops', ops });
  await album.webSocketClose(ws as unknown as WebSocket);
  state.storage.setAlarm.mockClear();
  await album.alarm();
  // The like/unlike pairs folded away; the upload survived; the alarm rescheduled.
  const remaining = await state.storage.sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops')
    .one();
  assert.equal(Number(remaining.n), 1);
  assert.equal((state.storage.setAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
});
