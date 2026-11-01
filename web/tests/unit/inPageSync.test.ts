// The in-page fallback transport (no SharedWorker, e.g. Safari on iOS): the same
// CoordinatorCore must sync through a per-tab socket. These tests drive the fallback end to
// end with a fake socket and fake-indexeddb — the regression they guard is the old state where
// a browser without SharedWorker queued ops forever and never synced.
import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { WsClientFrame, WsServerFrame } from '$shared/types';
import { appendOp, countOps, openOplogDb } from '../../src/core/oplog';
import { inPageTransport } from '../../src/sync/transport';
import type { WsSocket } from '../../src/core/api/wsClient';

const WELCOME: WsServerFrame = {
  type: 'welcome',
  selfId: 7,
  uuid: 'u-test',
  mediaHostUrl: 'https://facade.test',
  seq: 0,
};

/** A socket the test answers by hand; records every frame the coordinator sends. */
function fakeSocket() {
  const sent: WsClientFrame[] = [];
  const listeners = {
    open: [] as (() => void)[],
    close: [] as (() => void)[],
    error: [] as (() => void)[],
    message: [] as ((ev: { data: unknown }) => void)[],
  };
  const socket: WsSocket = {
    close: () => listeners.close.forEach((l) => l()),
    send: (data) => sent.push(JSON.parse(data) as WsClientFrame),
    addEventListener: (type, l) => {
      (listeners[type as keyof typeof listeners] as ((ev?: never) => void)[]).push(
        l as (ev?: never) => void,
      );
    },
  };
  return {
    socket,
    sent,
    open: () => listeners.open.forEach((l) => l()),
    deliver: (frame: WsServerFrame) =>
      listeners.message.forEach((l) => l({ data: JSON.stringify(frame) })),
    hangUp: () => listeners.close.forEach((l) => l()),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

test('in-page fallback: hello on open, welcome reaches the tab, ping keeps running', async () => {
  const db = await openOplogDb();
  const fake = fakeSocket();
  const frames: WsServerFrame[] = [];
  const states: { connected: boolean; syncing: boolean; pending: number }[] = [];
  const transport = inPageTransport({
    wsFactory: () => fake.socket,
    wsUrl: 'wss://test/ws',
    db,
  });
  transport.onFrame((frame) => frames.push(frame));
  transport.onState((state) => states.push(state));

  transport.init();
  await tick(); // the port hop + the IndexedDB recount reach connect() before 'open'
  fake.open();
  await tick();

  assert.deepEqual(
    fake.sent.map((f) => f.type),
    ['hello'],
    'the coordinator authenticates and declares its position on open',
  );
  const hello = fake.sent[0];
  assert.ok(hello?.type === 'hello', 'the first frame is the hello');
  assert.ok((hello.lastSeq ?? -1) >= 0, 'hello declares its catch-up position');

  fake.deliver(WELCOME);
  await tick();
  assert.deepEqual(frames, [WELCOME], 'the welcome snapshot frame reaches the engine');
  assert.equal(states.at(-1)!.connected, true, 'the tab learns it is connected');

  fake.sent.length = 0;
  fake.hangUp();
  await tick();
  assert.equal(states.at(-1)!.connected, false, 'a dropped socket returns to the offline state');
});

test('in-page fallback: a queued op flushes in one frame and its ack clears the queue', async () => {
  const db = await openOplogDb();
  const fake = fakeSocket();
  const drops: string[] = [];
  const states: { connected: boolean; syncing: boolean; pending: number }[] = [];
  const transport = inPageTransport({ wsFactory: () => fake.socket, wsUrl: 'wss://test/ws', db });
  transport.onDropped((cid) => drops.push(cid));
  transport.onState((state) => states.push(state));

  transport.init();
  await tick();
  fake.open();
  fake.deliver(WELCOME);
  await tick();

  const op = { type: 'like' as const, targetSha: 'aa', cid: 'cid-1', ct: 1 };
  await appendOp(db, op);
  fake.sent.length = 0;
  transport.queued();
  // queued → recount over IndexedDB → the 16 ms debounce: allow both hops to land.
  await tick();
  await tick();

  const opsFrame = fake.sent.find((f) => f.type === 'ops');
  assert.ok(opsFrame && opsFrame.type === 'ops', 'the queued op left as one ops frame');
  assert.deepEqual(opsFrame.ops, [op]);

  fake.deliver({
    type: 'ops',
    applied: [{ seq: 1, op, actor: 7, ts: 2_000, cid: 'cid-1' }],
  });
  await tick();
  assert.equal(await countOps(db), 0, 'the cid ack removed the queue entry');
  assert.equal(states.at(-1)!.pending, 0, 'the badge sees an empty queue');

  // A refused op rolls the tab's optimistic state back and leaves the queue too.
  await appendOp(db, { type: 'like' as const, targetSha: 'bb', cid: 'cid-2' });
  fake.deliver({ type: 'error', error: 'op_dropped', cid: 'cid-2' });
  await tick();
  assert.deepEqual(drops, ['cid-2'], 'the owning tab is told to roll back');
  assert.equal(await countOps(db), 0, 'the refused op does not linger in the queue');

  fake.hangUp();
});
