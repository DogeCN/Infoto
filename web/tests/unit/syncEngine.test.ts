// The sync engine over the /ws transport (ADR 0026): connection state, the offline
// queue's one-frame flush, client timestamps, the Turnstile hello, and the page-exit
// hand-off. The oplog semantics underneath are exercised by their own suites; these
// cases drive the engine through a scripted socket.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

import { MAX_SYNC_OPS, type Op, type SyncResponse } from '$shared/types';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog';
import { SyncEngine } from '../../src/core/engine';
import { autoServer, deadSocketFactory, FakeWebSocket, type WsStub } from './wsMock';

const op = (target: number): Op => ({ type: 'react', target, payload: { emoji: '👍' } });

const snapshot = (announcements: SyncResponse['announcements'] = []): SyncResponse => ({
  ok: true,
  serverTime: 1_000,
  selfId: 0,
  mediaHostUrl: 'https://facade.test',
  photos: [],
  announcements,
  polls: [],
  feedback: [],
});

let db: IDBDatabase;

beforeEach(async () => {
  db = await openOplogDb();
  await clearOps(db);
});

afterEach(async () => {
  try {
    db.close();
  } catch {
    // a test may have closed the connection itself
  }
});

/** Drain the timers and microtasks a connect → welcome → flush round needs. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const loggedCount = async (): Promise<number> => (await readOps(db)).length;

const syncFrames = (server: WsStub): Array<Record<string, unknown> & { type: string }> =>
  server.frames.filter((f) => f.type === 'sync');

test('SyncEngine: a commit while offline only queues, and stays put', async () => {
  const engine = new SyncEngine({
    db,
    wsFactory: deadSocketFactory(),
    wsUrl: 'ws://album.test/ws',
  });
  await engine.addOp(op(1));
  await engine.addOp(op(2));
  await settle();
  assert.equal(engine.state.connected, false);
  assert.equal(await loggedCount(), 2);
  assert.deepEqual(engine.state, { syncing: false, pending: 2, connected: false });
});

test('SyncEngine: welcome marks connected, and the backlog leaves in one frame', async () => {
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  const states: Array<Record<string, unknown>> = [];
  engine.onState((s) => states.push({ ...s }));
  const onSyncResponse = vi.fn();
  engine.rebind({ onSyncResponse });

  // Two commits while offline: queued, stamped, never flushed (nothing is connected).
  await engine.addOp(op(1));
  await engine.addOp(op(2));
  assert.equal(await loggedCount(), 2);
  await settle();
  assert.equal(syncFrames(server).length, 0, 'the offline queue stays put');

  // Page open: init connects, the welcome flips the state, and the whole backlog —
  // both ops, one frame.
  await engine.init();
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  const frames = syncFrames(server);
  assert.equal(frames.length, 1, 'the accumulated log leaves in one frame, never one per op');
  const ops = frames[0]!.ops as Op[];
  assert.deepEqual(
    ops.map((o) => o.target),
    [1, 2],
  );
  for (const o of ops) {
    assert.equal(typeof o.ts, 'number', 'the client stamps the real commit time');
    assert.ok(Math.abs((o.ts as number) - Date.now()) < 60_000);
  }
  assert.equal(await loggedCount(), 0, 'confirmed ops are cleared');
  assert.equal(onSyncResponse.mock.calls.length, 1, 'the snapshot reached the store');
  assert.deepEqual(states.at(-1), { syncing: false, pending: 0, connected: true });
});

test('SyncEngine: a connected commit flushes promptly, and a burst coalesces into one frame', async () => {
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  await engine.init();
  await vi.waitFor(() => assert.ok(engine.state.connected));
  server.frames.length = 0;

  await engine.addOp(op(1));
  await engine.addOp(op(2));
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  const frames = syncFrames(server);
  assert.equal(frames.length, 1, 'the burst rides one frame');
  assert.equal((frames[0]!.ops as Op[]).length, 2);
});

test('SyncEngine: a failed connection reports offline and keeps the queue', async () => {
  const engine = new SyncEngine({
    db,
    wsFactory: deadSocketFactory(),
    wsUrl: 'ws://album.test/ws',
  });
  const errors: Array<{ phase: string; message: string }> = [];
  engine.rebind({
    onError: (phase, error) => errors.push({ phase, message: (error as Error).message }),
  });
  await engine.addOp(op(1));
  await settle();
  assert.equal(engine.state.connected, false);
  const attempt = await engine.sync();
  assert.equal(attempt.ok, false, 'the button click fails honestly');
  assert.ok(
    errors.some((e) => e.phase === 'connect'),
    'the transport failure is reported',
  );
  assert.equal(await loggedCount(), 1, 'the op stays queued');
  assert.equal(engine.state.pending, 1);
});

test('SyncEngine: the button flow reconnects a dropped engine and flushes', async () => {
  // A factory whose sockets fail until the test flips the switch — the user fixes the
  // network, then clicks sync.
  let alive = false;
  const server = autoServer(snapshot());
  const factory = (url: string) => (alive ? server.factory(url) : deadSocketFactory()(url));
  const engine = new SyncEngine({ db, wsFactory: factory, wsUrl: 'ws://album.test/ws' });
  await engine.addOp(op(7));
  const first = await engine.sync();
  assert.equal(first.ok, false);
  assert.equal(await loggedCount(), 1, 'still queued while offline');

  alive = true;
  const second = await engine.sync();
  assert.equal(second.ok, true);
  assert.equal(await loggedCount(), 0, 'the backlog lands on reconnect');
  assert.equal(engine.state.connected, true);
});

test('SyncEngine: a dropped socket unmarks reserved ops and flips to offline', async () => {
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  await engine.init();
  await vi.waitFor(() => assert.ok(engine.state.connected));

  // The welcome already carried the empty-queue snapshot request; forget it.
  server.frames.length = 0;
  // The network dies right after the welcome: reserved-but-unconfirmed ops must unmark,
  // or every later flush would skip them.
  server.sockets[0]!.close();
  await settle();
  assert.equal(engine.state.connected, false);
  await engine.addOp(op(3));
  await settle();
  assert.equal(syncFrames(server).length, 0, 'a dead socket carries nothing');
  assert.equal(await loggedCount(), 1);
});

test('SyncEngine: hello without a token asks for verification, and the token rides the next hello', async () => {
  const frames: Array<Record<string, unknown> & { type: string }> = [];
  const factory = (url: string) => {
    const ws = new FakeWebSocket(url);
    ws.onSend = (frame) => {
      frames.push(frame);
      if (frame.type === 'hello') {
        if (frame.turnstileToken === 'tok') {
          ws.serverSend({
            type: 'welcome',
            selfId: 3,
            uuid: 'uuid-3',
            serverTime: 1,
            mediaHostUrl: 'https://facade.test',
          });
        } else {
          ws.serverSend({
            type: 'error',
            error: 'turnstile_required',
            turnstileSiteKey: 'site-key-1',
          });
        }
      }
      if (frame.type === 'sync') ws.serverSend({ type: 'synced', response: snapshot() });
    };
    setTimeout(() => ws.serverOpen(), 0);
    return ws;
  };
  const engine = new SyncEngine({ db, wsFactory: factory, wsUrl: 'ws://album.test/ws' });
  const onTurnstileRequired = vi.fn();
  engine.rebind({ onTurnstileRequired });

  await engine.init();
  await vi.waitFor(() => assert.equal(onTurnstileRequired.mock.calls.length, 1));
  assert.deepEqual(onTurnstileRequired.mock.calls[0], ['site-key-1']);
  assert.equal(engine.state.connected, false, 'an unauthenticated session is not connected');

  engine.verify('tok');
  await vi.waitFor(() => assert.ok(engine.state.connected));
  const hellos = frames.filter((f) => f.type === 'hello');
  assert.equal(hellos[0]!.turnstileToken, undefined, 'the first hello carries no token');
  assert.equal(hellos[1]!.turnstileToken, 'tok', 'the verified hello carries the token');
  await vi.waitFor(() =>
    assert.equal(
      frames.filter((f) => f.type === 'sync').length,
      1,
      'the flush follows the welcome',
    ),
  );
});

test('SyncEngine: a refused token re-asks, and the last known site key rides along', async () => {
  const factory = (url: string) => {
    const ws = new FakeWebSocket(url);
    ws.onSend = (frame) => {
      if (frame.type === 'hello') {
        if (frame.turnstileToken === 'good') {
          ws.serverSend({ type: 'welcome', selfId: 1, uuid: 'u', serverTime: 1, mediaHostUrl: '' });
        } else if (frame.turnstileToken === undefined) {
          // The first refusal carries the public key the widget renders with.
          ws.serverSend({
            type: 'error',
            error: 'turnstile_required',
            turnstileSiteKey: 'site-key-1',
          });
        } else {
          // A failed check carries no key; the engine must still be able to re-render
          // the widget from the key the first refusal supplied.
          ws.serverSend({ type: 'error', error: 'turnstile_failed' });
        }
      }
    };
    setTimeout(() => ws.serverOpen(), 0);
    return ws;
  };
  const engine = new SyncEngine({ db, wsFactory: factory, wsUrl: 'ws://album.test/ws' });
  const onTurnstileRequired = vi.fn();
  engine.rebind({ onTurnstileRequired });

  await engine.init();
  await vi.waitFor(() => assert.deepEqual(onTurnstileRequired.mock.calls[0], ['site-key-1']));
  engine.verify('bad');
  await vi.waitFor(() => assert.equal(onTurnstileRequired.mock.calls.length, 2));
  assert.deepEqual(onTurnstileRequired.mock.calls[1], ['site-key-1'], 'the cached key is reused');
  engine.verify('good');
  await vi.waitFor(() => assert.ok(engine.state.connected));
});

test('SyncEngine: a backlog larger than MAX_SYNC_OPS chunks into several frames', async () => {
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  for (let i = 0; i < MAX_SYNC_OPS + 1; i++) await engine.addOp(op(i));
  await engine.init();
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  const frames = syncFrames(server);
  assert.equal(frames.length, 2, 'one frame per MAX_SYNC_OPS chunk, never one per op');
  assert.equal((frames[0]!.ops as Op[]).length, MAX_SYNC_OPS);
  assert.equal((frames[1]!.ops as Op[]).length, 1);
});

test('SyncEngine: pagehide hands the queue to an open socket, and stays silent offline', async () => {
  class StubWindow {
    private listeners = new Map<string, Array<() => void>>();
    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    dispatch(type: string): void {
      for (const l of this.listeners.get(type) ?? []) l();
    }
  }
  const win = new StubWindow();

  // Offline: nothing is sent, the ops wait for the next session.
  const offline = new SyncEngine({
    db,
    wsFactory: deadSocketFactory(),
    wsUrl: 'ws://album.test/ws',
  });
  offline.install(win as unknown as Window);
  await offline.addOp(op(1));
  win.dispatch('pagehide');
  await settle();
  assert.equal(await loggedCount(), 1, 'an offline pagehide keeps the queue');

  // Connected: the page-exit trigger starts the same exchange a commit would.
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  engine.install(win as unknown as Window);
  await engine.init();
  await vi.waitFor(() => assert.ok(engine.state.connected));
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  server.frames.length = 0;
  await engine.addOp(op(9));
  win.dispatch('pagehide');
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  const dumps = syncFrames(server);
  assert.equal(dumps.length, 1, 'one exchange, never a pagehide dump beside the flush');
  assert.deepEqual(
    (dumps[0]!.ops as Op[]).map((o) => o.target),
    [9],
  );
});

test('SyncEngine: an op superseded in place stays one entry and rides one flush', async () => {
  const server = autoServer(snapshot());
  const engine = new SyncEngine({ db, wsFactory: server.factory, wsUrl: 'ws://album.test/ws' });
  await engine.addOp(op(1));
  await engine.addOp(op(1));
  assert.equal(await loggedCount(), 1, 'the second reaction replaced the first');
  await engine.init();
  await vi.waitFor(() => assert.equal(engine.state.pending, 0));
  const frames = syncFrames(server);
  assert.equal(frames.length, 1);
  assert.equal((frames[0]!.ops as Op[]).length, 1);
});
