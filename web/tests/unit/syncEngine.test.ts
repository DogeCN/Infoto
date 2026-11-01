// The per-tab sync engine over the coordinator transport (ADR 0026): op stamping
// (cid + ct), the own-echo skip, foreign-op application, the dropped-op rollback, the
// Turnstile pass-through, and the sync button's connect-or-flush behavior. The
// coordinator's protocol core has its own suite; the oplog semantics underneath are
// exercised by their own suites.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

import type { AlbumSnapshot, AppliedOp, Op, SyncResponse } from '$shared/types';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog';
import { SyncEngine } from '../../src/core/engine';
import { applied, FakeTransport } from './transportFake';

const op = (target: number): Op => ({ type: 'react', target, payload: { emoji: 'U+1F44D' } });

const welcomeFrame = (selfId = 0, withSnapshot = true) => ({
  type: 'welcome' as const,
  selfId,
  uuid: 'uuid-test',
  serverTime: 1_000,
  mediaHostUrl: 'https://facade.test',
  seq: 0,
  ...(withSnapshot
    ? {
        snapshot: {
          photos: [],
          announcements: [],
          polls: [],
          feedback: [],
        } satisfies AlbumSnapshot,
      }
    : {}),
});

let db: IDBDatabase;
let transport: FakeTransport;

beforeEach(async () => {
  db = await openOplogDb();
  await clearOps(db);
  transport = new FakeTransport();
});

afterEach(async () => {
  try {
    db.close();
  } catch {
    // a test may have closed the connection itself
  }
});

const engine = () => new SyncEngine({ db, transport });

const logged = async () => (await readOps(db)).map((entry) => entry.op);

test('SyncEngine: an op is queued with a client nonce and commit time', async () => {
  const e = engine();
  await e.addOp(op(1));
  const ops = await logged();
  assert.equal(ops.length, 1);
  assert.equal(typeof ops[0]!.cid, 'string', 'the ack correlation nonce is stamped');
  assert.equal(typeof ops[0]!.ct, 'number', 'the client commit time is stamped');
});

test('SyncEngine: a superseded op keeps its old nonce so its echo never applies', async () => {
  const e = engine();
  await e.addOp(op(1));
  const first = (await logged())[0]!;
  const firstCid = first.cid!;
  await e.addOp(op(1));
  const ops = await logged();
  assert.equal(ops.length, 1, 'replaced in place');
  assert.notEqual(ops[0]!.cid, firstCid, 'the replacement carries a fresh nonce');
  // The old nonce's echo must be skipped as own, never applied as foreign.
  let foreignSeen = 0;
  let ownSeen = 0;
  e.rebind({
    onServerOps: () => foreignSeen++,
    onOwnEcho: () => ownSeen++,
  });
  transport.serverSend({
    type: 'ops',
    applied: [applied(1, { ...first, payload: { emoji: 'old' } }, 0)],
  });
  assert.equal(ownSeen, 1, 'the stale echo routes to the own path');
  assert.equal(foreignSeen, 0, 'and never overwrites the optimistic state');
});

test('SyncEngine: welcome hands the snapshot to the store', async () => {
  const e = engine();
  const onSyncResponse = vi.fn();
  e.rebind({ onSyncResponse });
  await e.init();
  transport.serverSend(welcomeFrame(3));
  await vi.waitFor(() => assert.equal(onSyncResponse.mock.calls.length, 1));
  const response = onSyncResponse.mock.calls[0]![0] as SyncResponse;
  assert.equal(response.selfId, 3);
  assert.equal(response.mediaHostUrl, 'https://facade.test');
});

test('SyncEngine: a foreign broadcast applies, and an own echo routes to onOwnEcho', async () => {
  const e = engine();
  const onServerOps = vi.fn();
  const onOwnEcho = vi.fn();
  e.rebind({ onServerOps, onOwnEcho });
  await e.addOp(op(1));
  const mine = (await logged())[0]!;

  // Someone else's op: applied live.
  transport.serverSend({ type: 'ops', applied: [applied(9, op(2), 42)] });
  assert.equal(onServerOps.mock.calls.length, 1);
  assert.deepEqual(
    onServerOps.mock.calls[0]![0]!.map((a: AppliedOp) => a.op.target),
    [2],
  );

  // My own echo (the coordinator confirmed my queue entry): not re-applied.
  transport.serverSend({ type: 'ops', applied: [applied(10, mine, 7)] });
  assert.equal(onServerOps.mock.calls.length, 1, 'the own echo never applies');
  assert.equal(onOwnEcho.mock.calls.length, 1);
  assert.equal(onOwnEcho.mock.calls[0]![0]!.cid, mine.cid);
});

test('SyncEngine: a dropped op rolls back through onOpDropped', async () => {
  const e = engine();
  const onOpDropped = vi.fn();
  e.rebind({ onOpDropped });
  await e.addOp(op(1));
  const mine = (await logged())[0]!;
  transport.serverDrop(mine.cid!);
  assert.deepEqual(
    onOpDropped.mock.calls.map((c) => c[0]),
    [mine.cid],
  );
});

test('SyncEngine: the turnstile error rides to the widget, and verify passes the token on', async () => {
  const e = engine();
  const onTurnstileRequired = vi.fn();
  e.rebind({ onTurnstileRequired });
  transport.serverSend({ type: 'error', error: 'turnstile_required', turnstileSiteKey: 'k1' });
  assert.deepEqual(
    onTurnstileRequired.mock.calls.map((c) => c[0]),
    ['k1'],
  );
  e.verify('tok');
  assert.deepEqual(transport.tokens, ['tok']);
});

test('SyncEngine: the sync button connects when offline and flushes when online', async () => {
  const e = engine();
  transport.setState(false);
  const attempt = e.sync();
  assert.equal(transport.connectCalls, 1, 'the click opens the shared connection');
  // The welcome arrives: connected flips, the promise resolves ok.
  transport.serverSend(welcomeFrame());
  transport.setState(true);
  assert.deepEqual(await attempt, { ok: true });
  assert.equal(transport.flushCalls, 1, 'and the coordinator flushes');
});

test('SyncEngine: the sync button resolves ok immediately while connected', async () => {
  const e = engine();
  transport.setState(true);
  assert.deepEqual(await e.sync(), { ok: true });
  assert.equal(transport.flushCalls, 1);
  assert.equal(transport.connectCalls, 0, 'no reconnect is attempted');
});

test('SyncEngine: pagehide flushes through the transport, once per install', async () => {
  const e = engine();
  const win = {
    listeners: new Map<string, Array<() => void>>(),
    addEventListener(type: string, l: () => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
    },
    dispatch(type: string) {
      for (const l of this.listeners.get(type) ?? []) l();
    },
  };
  e.install(win as unknown as Window);
  e.install(win as unknown as Window);
  win.dispatch('pagehide');
  assert.equal(transport.flushCalls, 1, 'double install does not double the flush');
});

test('SyncEngine: the cached snapshot paints before the first exchange', async () => {
  // Seed the cache through a first welcome.
  const first = engine();
  const onSyncResponse = vi.fn();
  first.rebind({ onSyncResponse });
  await first.init();
  transport.serverSend(welcomeFrame());
  await vi.waitFor(() => assert.equal(onSyncResponse.mock.calls.length, 1));
  const response = onSyncResponse.mock.calls[0]![0] as SyncResponse;

  const onCached = vi.fn();
  const second = new SyncEngine({ db, transport, onCachedSnapshot: onCached });
  await second.init();
  assert.equal(onCached.mock.calls.length, 1);
  assert.equal((onCached.mock.calls[0]![0] as SyncResponse).selfId, response.selfId);
});
