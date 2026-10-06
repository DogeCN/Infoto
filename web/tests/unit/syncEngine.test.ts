import 'fake-indexeddb/auto';
import { afterEach, beforeEach, test, vi, type Mock } from 'vitest';
import assert from 'node:assert/strict';

import type { Op, SyncRequest, SyncResponse } from '$shared/types';
import type { SyncCallResult, SyncClientIo } from '../../src/core/api/syncClient';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog';
import {
  type EngineIo,
  KEEPALIVE_BODY_LIMIT,
  keepalivePrefix,
  SyncEngine,
} from '../../src/core/engine';

const op = (target: number): Op => ({
  type: 'react',
  target,
  payload: { emoji: '👍' },
});

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

const result = (response: SyncResponse): SyncCallResult => ({ response, status: 200 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

type FetchMock = Mock<(...args: Parameters<typeof fetch>) => Promise<Response>>;
type PostSyncMock = Mock<(body: SyncRequest, io?: SyncClientIo) => Promise<SyncCallResult>>;
type ErrorSink = Mock<(phase: 'submit' | 'pagehide', error: unknown) => void>;
type ArrangeCtx = { db: IDBDatabase; fetchFn: FetchMock };

/** Every onError call the engine made, reduced to comparable phase/message pairs. */
const reports = (sink: ErrorSink): Array<{ phase: string; message: string }> =>
  sink.mock.calls.map(([phase, error]) => ({ phase, message: (error as Error).message }));

class ListenerHub {
  private readonly listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class StubWindow extends ListenerHub {
  readonly location = { origin: 'http://localhost' };
}

class StubDocument extends ListenerHub {
  visibilityState: DocumentVisibilityState = 'visible';
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

let db: IDBDatabase;

// Fixtures shared by the in-flight dedup and pagehide flush cases.
let sink: ErrorSink;
let fetchFn: FetchMock;
let postSyncFn: PostSyncMock;
/** Every op the default postSync accepted — the runSync-side dedup recorder. */
let submitted: Op[];
let windowStub: StubWindow;
let documentStub: StubDocument;

/** Stand in for the stubbed `window` / `document` and their spies for one case. */
const arrangeFlushFixtures = (): void => {
  submitted = [];
  sink = vi.fn<(phase: 'submit' | 'pagehide', error: unknown) => void>();
  fetchFn = vi
    .fn<(...args: Parameters<typeof fetch>) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 200 }));
  postSyncFn = vi.fn((body: SyncRequest) => {
    submitted.push(...body.ops);
    return Promise.resolve(result(snapshot()));
  });
  windowStub = new StubWindow();
  documentStub = new StubDocument();
  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', documentStub);
};

const engine = (io: EngineIo = {}): SyncEngine =>
  new SyncEngine({ db, fetchFn, postSyncFn, onError: sink, ...io });

const installed = new WeakSet<SyncEngine>();
/** Fire pagehide through `install()` — never reach into private methods. */
const firePagehide = (e: SyncEngine): void => {
  if (!installed.has(e)) {
    e.install(windowStub as unknown as Window);
    installed.add(e);
  }
  windowStub.dispatch('pagehide');
};

/** Await an oplog read issued *after* a dispatch — same-store transactions run
 * in creation order, so this resolves once the pagehide dump has decided. */
const pagehideReadDone = async (): Promise<void> => {
  await readOps(db);
};

const dumpAndReports = async (
  e: SyncEngine,
): Promise<Array<{ phase: string; message: string }>> => {
  firePagehide(e);
  await vi.waitFor(() => assert.ok(sink.mock.calls.length > 0));
  return reports(sink);
};

beforeEach(async () => {
  db = await openOplogDb();
  await clearOps(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // a test may have closed the connection itself
  }
});

/** The flush cases leave stubbed globals behind; nothing else does. */
afterEach(() => {
  vi.unstubAllGlobals();
});

test('SyncEngine request: every sync and the pagehide dump carry ops and nothing else', async () => {
  arrangeFlushFixtures();
  documentStub.visibilityState = 'hidden';
  const requests: SyncRequest[] = [];
  const dumpBodies: string[] = [];
  fetchFn.mockImplementation((_url, init) => {
    dumpBodies.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  const e = engine({
    postSyncFn: (body) => {
      requests.push(body);
      return Promise.resolve(result(snapshot()));
    },
  });

  await e.addOp(op(1));
  await e.sync();
  assert.deepEqual(Object.keys(requests.at(-1)!).sort(), ['ops']);

  // The pagehide dump serializes its own body rather than going through postSyncFn, so
  // it is a second place the payload shape can drift. Queue the op after the sync, since
  // a drained oplog is exactly what the flush skips.
  await e.addOp(op(2));
  firePagehide(e);
  await vi.waitFor(() => assert.ok(dumpBodies.length > 0, 'pagehide sent a batch'));
  for (const body of dumpBodies) {
    assert.deepEqual(Object.keys(JSON.parse(body) as SyncRequest).sort(), ['ops']);
  }
});

test('SyncEngine awaitable sync: coalesces callers and retains concurrent edits for the next sync', async () => {
  const first = deferred<SyncCallResult>();
  const second = deferred<SyncCallResult>();
  const requests: SyncRequest[] = [];
  const postSyncFn = vi.fn((body: SyncRequest) => {
    requests.push(body);
    return requests.length === 1 ? first.promise : second.promise;
  });
  const engine = new SyncEngine({ db, postSyncFn });
  await engine.addOp({ type: 'fb_create', payload: { contentMd: 'body', locale: 'en-US' } });

  const active = engine.sync();
  const coalesced = engine.sync();
  await vi.waitFor(() => assert.equal(postSyncFn.mock.calls.length, 1));
  assert.equal(coalesced, active);

  await engine.addOp(op(-1));
  first.resolve(
    result(
      snapshot([
        {
          id: 9,
          title: 'new',
          contentMd: 'body',
          locale: 'en-US',
          sort: 0,
          updatedAt: 1_000,
          reactions: [],
        },
      ]),
    ),
  );
  assert.equal((await active).ok, true);
  assert.deepEqual(
    (await readOps(db)).map((entry) => entry.op),
    [op(-1)],
  );
  const nextSync = engine.sync();
  await vi.waitFor(() => assert.equal(postSyncFn.mock.calls.length, 2));

  assert.equal(requests[0]!.ops.length, 1);
  assert.deepEqual(requests[1]!.ops, [{ type: 'react', target: -1, payload: { emoji: '👍' } }]);
  second.resolve(
    result(
      snapshot([
        {
          id: 9,
          title: 't',
          contentMd: 'c',
          locale: 'en-US',
          sort: 0,
          updatedAt: 1_000,
          reactions: [],
        },
      ]),
    ),
  );

  assert.equal((await active).ok, true);
  assert.equal((await nextSync).ok, true);
});

test('SyncEngine awaitable sync: retains failed operations without timers and retries only on the next manual request', async () => {
  const postSyncFn = vi.fn().mockRejectedValue(new Error('offline'));
  const engine = new SyncEngine({ db, postSyncFn });
  await engine.addOp({ type: 'like', target: 2 });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    assert.equal((await engine.sync()).ok, false);
    await vi.advanceTimersByTimeAsync(120_000);
    assert.equal(postSyncFn.mock.calls.length, 1);
    assert.equal(vi.getTimerCount(), 0);
    assert.deepEqual(
      (await readOps(db)).map((entry) => entry.op),
      [{ type: 'like', target: 2 }],
    );
    postSyncFn.mockResolvedValue(result(snapshot()));
    assert.equal((await engine.sync()).ok, true);
    assert.equal(postSyncFn.mock.calls.length, 2);
    assert.equal((await readOps(db)).length, 0);
  } finally {
    vi.useRealTimers();
  }
});

test('SyncEngine awaitable sync: reports confirmation only through the ops the request actually carried', async () => {
  const engine = new SyncEngine({
    db,
    postSyncFn: vi.fn().mockResolvedValue(result(snapshot())),
  });
  const first = await engine.addOp(op(-1));
  const second = await engine.addOp(op(-2));
  assert.ok(second > first);

  // Confirm only the highest operation key carried by the request.
  assert.deepEqual(await engine.sync(), { ok: true, confirmedThroughVersion: second });
});

test('SyncEngine in-flight dedup and pagehide flush: install() wires the pagehide dump only — hiding the tab is not a trigger', async () => {
  arrangeFlushFixtures();
  const e = engine();
  e.install(windowStub as unknown as Window);
  await e.addOp(op(-1));

  windowStub.dispatch('pagehide');
  await vi.waitFor(() => assert.equal(fetchFn.mock.calls.length, 1));
  assert.equal(fetchFn.mock.calls[0]![1]?.keepalive, true);

  // Tab visibility changes do not send durable operations.
  documentStub.visibilityState = 'hidden';
  documentStub.dispatch('visibilitychange');
  await pagehideReadDone();
  assert.equal(postSyncFn.mock.calls.length, 0);
});

test('SyncEngine in-flight dedup and pagehide flush: a sync requested while the document is hidden goes out keepalive', async () => {
  arrangeFlushFixtures();
  const e = engine();
  await e.addOp(op(-1));
  documentStub.visibilityState = 'hidden';

  await e.sync();

  assert.equal(postSyncFn.mock.calls.length, 1);
  assert.deepEqual(postSyncFn.mock.calls[0]![1], { keepalive: true });
});

test('SyncEngine in-flight dedup and pagehide flush: does not resubmit ops a pagehide keepalive already carries', async () => {
  arrangeFlushFixtures();
  const keepalive = deferred<Response>();
  fetchFn.mockImplementation(() => keepalive.promise);
  const e = engine();
  await e.addOp({ type: 'fb_create', payload: { contentMd: 'body', locale: 'en-US' } });
  await e.addOp(op(-1));

  firePagehide(e);
  await vi.waitFor(() => assert.equal(fetchFn.mock.calls.length, 1));
  const carried = (JSON.parse(fetchFn.mock.calls[0]![1]?.body as string) as SyncRequest).ops;
  assert.equal(carried.length, 2);

  assert.equal((await e.sync()).ok, true);
  const carriedJson = new Set(carried.map((o) => JSON.stringify(o)));
  assert.deepEqual(
    submitted.filter((o) => carriedJson.has(JSON.stringify(o))),
    [],
  );
  assert.equal((await readOps(db)).length, 2); // still queued: the keepalive has not settled

  keepalive.resolve(new Response(null, { status: 200 }));
  await vi.waitFor(async () => {
    assert.equal((await readOps(db)).length, 0);
  });
});

test('SyncEngine in-flight dedup and pagehide flush: clears only the ops the keepalive sent when one lands mid-flight', async () => {
  arrangeFlushFixtures();
  const keepalive = deferred<Response>();
  fetchFn.mockImplementation(() => keepalive.promise);
  const e = engine();
  await e.addOp(op(-1));

  firePagehide(e);
  await vi.waitFor(() => assert.equal(fetchFn.mock.calls.length, 1));
  const queued: Op = { type: 'like', target: 2 };
  await e.addOp(queued);

  keepalive.resolve(new Response(null, { status: 200 }));
  await vi.waitFor(async () => {
    assert.equal((await readOps(db)).length, 1);
  });
  assert.deepEqual(
    (await readOps(db)).map((entry) => entry.op),
    [queued],
  );
});

test('SyncEngine in-flight dedup and pagehide flush: drops an op owned by an active sync from the pagehide dump', async () => {
  arrangeFlushFixtures();
  const syncCall = deferred<SyncCallResult>();
  const e = engine({
    postSyncFn: (body) => {
      submitted.push(...body.ops);
      return syncCall.promise;
    },
  });
  const only = op(-1);
  await e.addOp(only);

  const attempt = e.sync();
  await vi.waitFor(() => assert.deepEqual(submitted, [only]));

  firePagehide(e);
  await pagehideReadDone();
  assert.equal(fetchFn.mock.calls.length, 0);

  syncCall.resolve(result(snapshot()));
  assert.equal((await attempt).ok, true);
  assert.equal((await readOps(db)).length, 0);
});

test('SyncEngine in-flight dedup and pagehide flush: does not double-send when pagehide fires twice during a keepalive', async () => {
  arrangeFlushFixtures();
  const keepalive = deferred<Response>();
  fetchFn.mockImplementation(() => keepalive.promise);
  const e = engine();
  await e.addOp(op(-1));

  firePagehide(e);
  await vi.waitFor(() => assert.equal(fetchFn.mock.calls.length, 1));

  firePagehide(e);
  await pagehideReadDone();
  assert.equal(fetchFn.mock.calls.length, 1);

  keepalive.resolve(new Response(null, { status: 200 }));
  await vi.waitFor(async () => {
    assert.equal((await readOps(db)).length, 0);
  });

  firePagehide(e); // nothing queued anymore
  await pagehideReadDone();
  assert.equal(fetchFn.mock.calls.length, 1);
});

const fetchFailures: Array<{
  name: string;
  arrange: (ctx: ArrangeCtx) => void;
  verify: (reported: Array<{ phase: string; message: string }>) => void;
}> = [
  {
    name: 'a synchronously throwing fetch',
    arrange: ({ fetchFn: f }) =>
      f.mockImplementation(() => {
        throw new Error('fetch exploded');
      }),
    verify: (reported) =>
      assert.deepEqual(reported, [{ phase: 'pagehide', message: 'fetch exploded' }]),
  },
  {
    name: 'a rejected keepalive request',
    arrange: ({ fetchFn: f }) => f.mockImplementation(() => Promise.reject(new Error('offline'))),
    verify: (reported) => assert.deepEqual(reported, [{ phase: 'pagehide', message: 'offline' }]),
  },
  {
    name: 'a non-ok response',
    arrange: ({ fetchFn: f }) =>
      f.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 }))),
    verify: (reported) =>
      assert.deepEqual(reported, [
        { phase: 'pagehide', message: 'pagehide flush rejected: HTTP 500' },
      ]),
  },
];

test.each(fetchFailures)(
  'SyncEngine in-flight dedup and pagehide flush: reports $name, keeps the op, and lets the next dump retry',
  async ({ arrange, verify }) => {
    arrangeFlushFixtures();
    const e = engine();
    await e.addOp(op(-1));
    arrange({ db, fetchFn });

    verify(await dumpAndReports(e));
    assert.deepEqual(
      (await readOps(db)).map((entry) => entry.op),
      [op(-1)],
    );

    firePagehide(e);
    await vi.waitFor(() => assert.equal(fetchFn.mock.calls.length, 2));
  },
);

const oplogFailures: Array<{
  name: string;
  arrange: (ctx: ArrangeCtx) => void;
}> = [
  {
    name: 'a failed oplog read',
    arrange: ({ db: d }) => {
      d.close();
    },
  },
  {
    name: 'a failed oplog clear',
    arrange: ({ db: d, fetchFn: f }) => {
      f.mockImplementation(() => {
        d.close(); // 200 comes back, but the connection the clear needs is gone
        return Promise.resolve(new Response(null, { status: 200 }));
      });
    },
  },
];

test.each(oplogFailures)(
  'SyncEngine in-flight dedup and pagehide flush: reports $name instead of swallowing it',
  async ({ arrange }) => {
    arrangeFlushFixtures();
    const e = engine();
    await e.addOp(op(-1));
    arrange({ db, fetchFn });

    const reported = await dumpAndReports(e);
    assert.equal(reported.length, 1);
    assert.equal(reported[0]!.phase, 'pagehide');
    assert.equal(typeof reported[0]!.message, 'string');
  },
);

test('SyncEngine in-flight dedup and pagehide flush: passes keepalive only for a sync started on a hidden document', async () => {
  arrangeFlushFixtures();
  const e = engine();
  await e.addOp(op(-1));

  await e.sync();
  assert.deepEqual(postSyncFn.mock.calls[0]![1], { keepalive: false });

  documentStub.visibilityState = 'hidden';
  await e.addOp(op(-2));
  await e.sync();
  assert.deepEqual(postSyncFn.mock.calls[1]![1], { keepalive: true });
});

test('SyncEngine in-flight dedup and pagehide flush: falls back to a plain request when a hidden batch busts the keepalive cap', async () => {
  arrangeFlushFixtures();
  documentStub.visibilityState = 'hidden';
  const e = engine();
  await e.addOp({
    type: 'fb_create',
    payload: { contentMd: 'x'.repeat(KEEPALIVE_BODY_LIMIT) },
  });

  await e.sync();
  assert.deepEqual(postSyncFn.mock.calls[0]![1], { keepalive: false });
  assert.equal((await readOps(db)).length, 0);
});

test('SyncEngine batch limits: keeps a large backlog local until tab initialization drains bounded batches', async () => {
  const { MAX_SYNC_OPS } = await import('$shared/types');
  const postSyncFn = vi.fn().mockResolvedValue(result(snapshot()));
  const onSyncResponse = vi.fn();
  const engine = new SyncEngine({ db, postSyncFn, onSyncResponse });
  for (let i = 0; i < MAX_SYNC_OPS + 3; i++) await engine.addOp(op(i));
  assert.equal(postSyncFn.mock.calls.length, 0);
  assert.equal(engine.state.pending, 503);
  await engine.init();
  assert.equal((await engine.sync()).ok, true);
  assert.deepEqual(
    postSyncFn.mock.calls.map(([body]) => body.ops.length),
    [MAX_SYNC_OPS, 3],
  );
  assert.deepEqual(onSyncResponse.mock.calls[0][1].queuedOps, [op(500), op(501), op(502)]);
  assert.equal((await readOps(db)).length, 0);
});

test('SyncEngine batch limits: keeps the unconfirmed suffix when a later batch fails', async () => {
  const { appendOp } = await import('../../src/core/oplog');
  for (let i = 0; i < 501; i++) await appendOp(db, op(i));
  const entries = await readOps(db);
  const postSyncFn = vi
    .fn()
    .mockResolvedValueOnce(result(snapshot()))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(result(snapshot()));
  const engine = new SyncEngine({ db, postSyncFn });
  const failed = await engine.sync();
  assert.equal(failed.ok, false);
  assert.equal(failed.confirmedThroughVersion, entries[499].key);
  assert.deepEqual(
    (await readOps(db)).map((entry) => entry.op),
    [op(500)],
  );
  await engine.sync();
  assert.equal((await readOps(db)).length, 0);
});

test('SyncEngine batch limits: limits pagehide batches by count as well as bytes', async () => {
  assert.equal(keepalivePrefix(Array.from({ length: 600 }, (_, i) => op(i)))?.ops.length, 500);
});

test('SyncEngine batch limits: reports storage failures and releases the syncing state', async () => {
  const onError = vi.fn();
  const engine = new SyncEngine({ db, onError });
  db.close();
  vi.useFakeTimers();
  try {
    assert.equal((await engine.sync()).ok, false);
    assert.equal(engine.state.syncing, false);
    assert.equal(onError.mock.calls.length, 1);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

test('keepalivePrefix: sends the longest prefix that fits the browser body cap', () => {
  assert.equal(KEEPALIVE_BODY_LIMIT, 65_536);
  const ops = [op(1), op(2), op(3)];
  const whole = keepalivePrefix(ops);
  assert.deepEqual(whole!.ops, ops);
  assert.deepEqual(JSON.parse(whole!.body), { ops });
  assert.ok(bytes(whole!.body) <= KEEPALIVE_BODY_LIMIT);

  // Accounting is in UTF-8 bytes, not characters: multi-byte payloads cost more.
  const big: Op = {
    type: 'fb_create',
    target: null,
    payload: { contentMd: '€'.repeat(2000) + '🔥' },
  };
  const fit = keepalivePrefix([op(1), big, big, op(2)], 8_000);
  assert.deepEqual(fit!.ops, [op(1), big]);
  assert.ok(bytes(fit!.body) <= 8_000);
  assert.ok(
    bytes(`{"ops":[${JSON.stringify(op(1))},${JSON.stringify(big)},${JSON.stringify(big)}]}`) >
      8_000,
  );

  const giant: Op = {
    type: 'fb_create',
    target: null,
    payload: { contentMd: 'x'.repeat(70_000) },
  };
  assert.equal(keepalivePrefix([giant]), null);
  assert.deepEqual(keepalivePrefix([op(1), giant])!.ops, [op(1)]);
});

test('removeOpsBySha withdraws a pending upload op and keeps the pending count honest', async () => {
  const uploadOp = (sha: string): Op => ({
    type: 'upload',
    targetSha: sha,
    payload: {
      sha256: sha,
      url: `https://cdn.test/${sha}.webp`,
      width: 1,
      height: 1,
      size: 1,
      type: 0,
    },
  });
  const e = engine();
  await e.addOp(uploadOp('sha-a'));
  await e.addOp(uploadOp('sha-b'));
  assert.equal(e.state.pending, 2);

  assert.equal(await e.removeOpsBySha('sha-a'), 1);
  assert.equal(e.state.pending, 1);
  assert.deepEqual(
    (await readOps(db)).map((entry) => entry.op.targetSha),
    ['sha-b'],
  );
  // Withdrawing an absent sha changes nothing, including the pending count.
  assert.equal(await e.removeOpsBySha('sha-a'), 0);
  assert.equal(e.state.pending, 1);
});
