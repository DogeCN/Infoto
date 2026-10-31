// The /ws Durable Object's protocol, driven frame by frame against a fake socket and a
// local D1: session resolution (cookie or Turnstile hello), the sync frame contract, and
// the refusals an unauthenticated or malformed frame earns.

import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { WsServerFrame } from '../../shared/types.ts';
import type { DbStatement } from '../db.ts';
import { Album, type AlbumEnv } from './Album.ts';
import { ALWAYS_PASS_SECRET } from '../turnstile.ts';
import { openLocalDb, type LocalDb } from '../../testing/localDb.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');

/** A D1Database-shaped adapter over the local Db — exactly what `d1Db` touches, including
 *  D1's result shape (`{ results }` / `{ meta }`), which the local Db does not use. */
function fakeD1(db: LocalDb): D1Database {
  const bindable = (sql: string) => {
    const bound = (values: unknown[]) => ({
      // A D1PreparedStatement carries its own sql/binds — `db.batch` reads them, so the
      // fake must carry them too, or a batch loses every statement it holds.
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

/** The server side of one connection: captures sends, keeps its attachment. */
class FakeConn {
  sent: WsServerFrame[] = [];
  private attachment: unknown;
  private listeners = new Map<string, Array<(ev?: unknown) => void>>();
  addEventListener(type: string, listener: (ev?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsServerFrame);
  }
  close(): void {
    /* the object never hibernates under test */
  }
  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

function makeAlbum(opts: Partial<AlbumEnv> = {}): { album: Album; db: LocalDb } {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  const env: AlbumEnv = {
    DB: fakeD1(db),
    MEDIA_HOST_URL: 'https://facade.test',
    TURNSTILE_SECRET_KEY: ALWAYS_PASS_SECRET,
    TURNSTILE_SITE_KEY: 'site-key-1',
    ...opts,
  };
  const state = { acceptWebSocket: vi.fn() } as unknown as DurableObjectState;
  return { album: new Album(state, env), db };
}

async function deliver(album: Album, ws: FakeConn, frame: unknown): Promise<void> {
  await album.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(frame));
}

test('album do: a plain HTTP request to the endpoint is refused', async () => {
  const { album } = makeAlbum();
  const res = await album.fetch(new Request('https://album.test/ws'));
  assert.equal(res.status, 426);
});

test('album do: hello without identity or token asks for verification', async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await deliver(album, ws, { type: 'hello' });
  assert.deepEqual(ws.sent, [
    { type: 'error', error: 'turnstile_required', turnstileSiteKey: 'site-key-1' },
  ]);
});

test('album do: a hello with a token creates the identity and the sync frame answers with the snapshot', async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await deliver(album, ws, { type: 'hello', turnstileToken: 'tok' });
  const welcome = ws.sent[0]!;
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.type === 'welcome' ? welcome.selfId : -1, 0, 'the first visitor is root');
  assert.equal(welcome.type === 'welcome' ? welcome.mediaHostUrl : '', 'https://facade.test');

  const uploadOp = {
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
  };
  await deliver(album, ws, { type: 'sync', ops: [uploadOp] });
  const synced = ws.sent[1]!;
  assert.equal(synced.type, 'synced');
  if (synced.type !== 'synced') return;
  assert.equal(synced.response.ok, true);
  assert.deepEqual(
    synced.response.photos.map((p) => p.sha256),
    ['aa'],
  );
  assert.equal(synced.response.mediaHostUrl, 'https://facade.test');
});

test('album do: a sync frame before hello is refused, and the socket stays open', async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await deliver(album, ws, { type: 'sync', ops: [] });
  assert.deepEqual(ws.sent, [{ type: 'error', error: 'unauthenticated' }]);
});

test('album do: a cookie-resolved connection greets without a token', async () => {
  const { album, db } = makeAlbum();
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (0, 'root-uuid', 1);");
  const ws = new FakeConn();
  // The upgrade path resolves the uuid cookie and serializes the session onto the socket.
  // The 101 response itself cannot be constructed under undici (status < 200), so the test
  // stages exactly what `fetch` does and drives hello over it.
  ws.serializeAttachment({ userId: 0, uuid: 'root-uuid' });
  await deliver(album, ws, { type: 'hello' });
  const welcome = ws.sent[0]!;
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.type === 'welcome' ? welcome.selfId : -1, 0);
  assert.equal(welcome.type === 'welcome' ? welcome.uuid : '', 'root-uuid');
});

test("album do: feedback keeps the op's own commit time, not the frame's arrival", async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await deliver(album, ws, { type: 'hello', turnstileToken: 'tok' });
  ws.sent.length = 0;
  const now = 1_900_000_000_000;
  const earlier = now - 60_000;
  const realNow = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await deliver(album, ws, {
      type: 'sync',
      ops: [
        { type: 'fb_create', payload: { contentMd: 'earlier', locale: 'en-US' }, ts: earlier },
        { type: 'fb_create', payload: { contentMd: 'at-arrival', locale: 'en-US' } },
      ],
    });
  } finally {
    realNow.mockRestore();
  }
  const synced = ws.sent[0]!;
  if (synced.type !== 'synced') return assert.fail('expected a synced frame');
  const byContent = new Map(synced.response.feedback.map((f) => [f.contentMd, f.createdAt]));
  assert.equal(byContent.get('earlier'), earlier, 'the offline timestamp survives');
  assert.equal(byContent.get('at-arrival'), now);
});

test('album do: a frame over the op cap is refused whole', async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await deliver(album, ws, { type: 'hello', turnstileToken: 'tok' });
  ws.sent.length = 0;
  const { MAX_SYNC_OPS } = await import('../../shared/types.ts');
  await deliver(album, ws, {
    type: 'sync',
    ops: Array.from({ length: MAX_SYNC_OPS + 1 }, () => ({ type: 'react', target: 1 })),
  });
  assert.deepEqual(ws.sent, [{ type: 'error', error: 'too_many_ops' }]);
});

test('album do: a malformed frame and a ping get the right answers', async () => {
  const { album } = makeAlbum();
  const ws = new FakeConn();
  await album.webSocketMessage(ws as unknown as WebSocket, 'not json');
  assert.deepEqual(ws.sent, [{ type: 'error', error: 'bad_json' }]);
  ws.sent.length = 0;
  await deliver(album, ws, { type: 'ping' });
  assert.equal(ws.sent[0]!.type, 'pong');
  ws.sent.length = 0;
  await deliver(album, ws, { type: 'wat' });
  assert.deepEqual(ws.sent, [{ type: 'error', error: 'bad_request' }]);
});
