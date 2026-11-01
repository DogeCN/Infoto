// The /ws Durable Object's protocol against a fake socket, a real SQLite op log, and a
// fake D1: session resolution, kick-dedup, catch-up, ingest with cid idempotency, the
// broadcast filter, the idle archive alarm, and the internal flush/rehydrate endpoints.

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
      run: (...b: never[]) => unknown;
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
    batch: async (stmts: readonly DbStatement[]) =>
      (await db.batch(stmts)).map((r) => ({
        meta: { changes: r.changes, last_row_id: r.last_row_id },
      })),
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
        // The real storage.sql executes eagerly on exec() and returns a cursor for
        // reads; mirror that, including RETURNING rows for writes. `.one()` throws when a
        // query returns no row — that contract is what `.toArray()` callers rely on, and
        // a harness that answered `undefined` instead hid a cold-object crash.
        exec: <T>(query: string, ...binds: unknown[]) => {
          if (/\breturning\b/i.test(query)) {
            const row = rawStorage.prepare(query).get(...(binds as never[])) as T;
            return { one: async () => row, toArray: async () => [row] as T[] };
          }
          if (/^\s*(select|with)\b/i.test(query)) {
            const rows = rawStorage.prepare(query).all(...(binds as never[])) as T[];
            return {
              one: async () => {
                if (rows.length !== 1)
                  throw new Error(
                    'Expected exactly one result from SQL query, but got no results.',
                  );
                return rows[0] as T;
              },
              toArray: async () => rows,
            };
          }
          rawStorage.prepare(query).run(...(binds as never[]));
          return { one: async () => undefined as T, toArray: async () => [] as T[] };
        },
      },
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
    },
    getWebSockets: () => sockets.filter((s) => !s.closed),
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
  const { album, connect } = makeAlbum();
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
  // The hot path never writes D1: /l/ links resolve through this object.
  const probe = await album.fetch(
    new Request('https://album.internal/internal/photo/' + (1).toString(36)),
  );
  assert.equal(probe.status, 200);
  const body = (await probe.json()) as { found: boolean; url: string };
  assert.equal(body.found, true);
  assert.equal(body.url, 'https://facade.test/a.webp');
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
  const up = (n: number, cid: string) => ({
    type: 'upload',
    payload: {
      sha256: `sha-${n}`,
      url: `https://facade.test/${n}.webp`,
      width: 1,
      height: 1,
      size: 2,
      type: 0,
      createdAt: 1_700_000_000_000 + n,
    },
    cid,
  });
  await deliver(album, first, { type: 'ops', ops: [up(1, 'c1'), up(2, 'c2')] });

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
  assert.equal(w2.snapshot!.photos.length, 2);
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
  const { album, connect } = makeAlbum();
  const old = connect();
  await authenticate(album, old); // creates the user (id 0)
  const replacement = connect();
  // Same session resolved (the cookie path), so hello sees the same user and kicks.
  replacement.serializeAttachment({ userId: 0, uuid: 'u0' });
  await deliver(album, replacement, { type: 'hello' });
  assert.equal(old.closeCode, 4001, 'the older socket was kicked');
  assert.equal(replacement.closed, false);
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

test('album do: internal flush archives the log into D1, and rehydrate forgets it', async () => {
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
  // The hot path left D1 empty; the flush is what archives the log into it.
  await album.fetch(new Request('https://album.internal/internal/flush'));
  const photos = await db.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
  assert.equal(photos!.n, 1, 'the flush archives the logged op');

  // Import-style rehydration: the object forgets its hot state and reads D1 back.
  await db.exec('DELETE FROM photos');
  await album.fetch(new Request('https://album.internal/internal/rehydrate'));
  const probe = await album.fetch(
    new Request('https://album.internal/internal/photo/' + (1).toString(36)),
  );
  assert.equal(probe.status, 404, 'the rehydrated snapshot is empty, like D1');
});

test('album do: the last departure sets the idle archive alarm, a return clears it', async () => {
  const { album, connect, state } = makeAlbum();
  const ws = connect();
  await authenticate(album, ws);
  // workerd removes the departing socket before the handler runs.
  ws.close();
  await album.webSocketClose(ws as unknown as WebSocket);
  assert.equal((state.storage.setAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  const again = connect();
  state.storage.deleteAlarm.mockClear();
  await authenticate(album, again);
  assert.equal((state.storage.deleteAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
});

test('album do: the idle alarm archives the log to D1 and reschedules', async () => {
  const { album, db, connect, state } = makeAlbum();
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
  // workerd removes the departing socket before the handler runs.
  ws.close();
  await album.webSocketClose(ws as unknown as WebSocket);
  state.storage.setAlarm.mockClear();
  await album.alarm();
  // One archive path, no folding: the log leaves D1 exactly current — the photo row exists,
  // its mark columns carry the net of the like/unlike pairs — and the object's log is empty.
  const photo = await db
    .prepare('SELECT likes, dislikes FROM photos WHERE sha256 = ?')
    .bind('aa')
    .first<{ likes: string; dislikes: string }>();
  assert.ok(photo, 'the upload was archived');
  assert.equal(photo.likes, '[]', 'the cancelling pairs net out in the snapshot');
  const remaining = await state.storage.sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops')
    .one();
  assert.equal(Number(remaining.n), 0, 'the archive emptied the log');
  assert.equal((state.storage.setAlarm as ReturnType<typeof vi.fn>).mock.calls.length, 1);
});

test('album do: an op this actor may never apply is refused before the log', async () => {
  const { album, db, connect } = makeAlbum();
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (0, 'root', 1);");
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (1, 'guest', 2);");

  const root = connect();
  root.serializeAttachment({ userId: 0, uuid: 'root' });
  await authenticate(album, root);
  await deliver(album, root, {
    type: 'ops',
    ops: [
      {
        type: 'upload',
        cid: 'u1',
        payload: {
          sha256: 'victim',
          url: 'https://facade.test/v.webp',
          width: 1,
          height: 1,
          size: 2,
          type: 0,
          createdAt: 1_700_000_000_000,
        },
      },
    ],
  });
  // Archive it first, so a stray delete would really reach D1.
  await album.fetch(new Request('https://album.internal/internal/flush'));
  const before = await db.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
  assert.equal(before!.n, 1, 'the photo is archived before the refused write');

  // A non-root guest sends a root-only delete: refused, not stored, not broadcast.
  const guest = connect();
  guest.serializeAttachment({ userId: 1, uuid: 'guest' });
  await authenticate(album, guest);
  guest.frames.length = 0;
  await deliver(album, guest, {
    type: 'ops',
    ops: [{ type: 'delete', cid: 'd1', targetSha: 'victim' }],
  });
  assert.deepEqual(guest.frames, [{ type: 'error', error: 'op_dropped', cid: 'd1' }]);

  const logged = await album['state'].storage.sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops')
    .one();
  assert.equal(Number(logged.n), 0, 'a refused op is never written to the log');

  await album.fetch(new Request('https://album.internal/internal/flush'));
  const after = await db.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
  assert.equal(after!.n, 1, 'the refused delete never reaches D1');
});

test('album do: an announcement too long to store is refused before the log', async () => {
  const { album, db, connect } = makeAlbum();
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (0, 'root', 1);");
  const root = connect();
  root.serializeAttachment({ userId: 0, uuid: 'root' });
  await authenticate(album, root);
  root.frames.length = 0;
  const { MAX_TEXT_LENGTH } = await import('../../shared/types.ts');
  await deliver(album, root, {
    type: 'ops',
    ops: [
      {
        type: 'ann_create',
        cid: 'a1',
        payload: { title: 't', contentMd: 'x'.repeat(MAX_TEXT_LENGTH + 1), locale: 'en-US' },
      },
    ],
  });
  assert.deepEqual(root.frames, [{ type: 'error', error: 'op_dropped', cid: 'a1' }]);
  const logged = await album['state'].storage.sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops')
    .one();
  assert.equal(Number(logged.n), 0, 'an unstorable announcement is never written to the log');
});

test('album do: a client ahead of the log gets a whole snapshot after a rehydrate', async () => {
  const { album, connect } = makeAlbum();
  const up = (n: number, cid: string) => ({
    type: 'upload',
    cid,
    payload: {
      sha256: `sha-${n}`,
      url: `https://facade.test/${n}.webp`,
      width: 1,
      height: 1,
      size: 2,
      type: 0,
      createdAt: 1_700_000_000_000 + n,
    },
  });
  const ws = connect();
  ws.serializeAttachment({ userId: 0, uuid: 'root' });
  await deliver(album, ws, { type: 'hello', turnstileToken: 'tok' });
  await deliver(album, ws, { type: 'ops', ops: [up(1, 'c1'), up(2, 'c2')] });
  const frames = ws.frames.filter((f) => f.type === 'ops');
  const lastSeq = frames
    .flatMap((f) => (f.type === 'ops' ? f.applied : []))
    .reduce((m, a) => Math.max(m, a.seq), 0);

  // A migrate import replaced D1 and told the object to forget everything.
  await album.fetch(new Request('https://album.internal/internal/rehydrate'));

  // The same client reconnects claiming the seq it still holds. The server has issued no
  // such seq any more, so it must hand over the snapshot rather than an empty increment.
  const again = connect();
  again.serializeAttachment({ userId: 0, uuid: 'root' });
  await deliver(album, again, { type: 'hello', lastSeq });
  const welcome = again.frames[0]!;
  assert.equal(welcome.type, 'welcome');
  assert.ok(welcome.type === 'welcome' && welcome.snapshot, 'a client past maxSeq gets a snapshot');
});

test('album do: a create op carries the id the server allocated', async () => {
  const { album, db, connect } = makeAlbum();
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (0, 'root', 1);");
  const root = connect();
  root.serializeAttachment({ userId: 0, uuid: 'root' });
  await authenticate(album, root);
  root.frames.length = 0;
  await deliver(album, root, {
    type: 'ops',
    ops: [
      { type: 'ann_create', cid: 'a1', payload: { title: 't', contentMd: 'md', locale: 'en-US' } },
    ],
  });
  const broadcast = root.frames.find((f) => f.type === 'ops');
  assert.ok(broadcast && broadcast.type === 'ops', 'the create was broadcast');
  const payload = (broadcast.applied[0]!.op as { payload?: { id?: number } }).payload!;
  assert.equal(payload.id, 1, 'the allocated id rides on the broadcast op');
});
