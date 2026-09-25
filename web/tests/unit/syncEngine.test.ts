import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Op, SyncRequest, SyncResponse } from '$shared/types';
import type { SyncCallResult, SyncClientIo } from '../../src/core/api/syncClient';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog/store';
import type { EngineIo } from '../../src/core/sync/engine';
import { KEEPALIVE_BODY_LIMIT, SyncEngine } from '../../src/core/sync/engine';

const op = (target: number): Op => ({
  type: 'react',
  target,
  payload: { emoji: '👍' },
});

const snapshot = (announcements: SyncResponse['announcements'] = []): SyncResponse => ({
  ok: true,
  serverTime: 1_000,
  selfId: 0,
  photos: [],
  announcements,
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

/** Every onError call the engine made, normalised for a single toEqual. */
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

let db: IDBDatabase;

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

describe('SyncEngine awaitable sync', () => {
  it('coalesces callers and flushes an op appended during an in-flight request', async () => {
    const first = deferred<SyncCallResult>();
    const second = deferred<SyncCallResult>();
    const requests: SyncRequest[] = [];
    const postSyncFn = vi.fn((body: SyncRequest) => {
      requests.push(body);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const engine = new SyncEngine({ db, postSyncFn });
    await engine.addOp({ type: 'fb_create', payload: { contentMd: 'body' } });

    const active = engine.sync();
    const coalesced = engine.sync();
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(1));
    expect(coalesced).toBe(active);

    const version = await engine.addOp(op(-1));
    const firstFlush = engine.flushThrough(version);
    const secondFlush = engine.flushThrough(version);
    first.resolve(
      result(
        snapshot([
          {
            id: 9,
            title: 'new',
            contentMd: 'body',
            sort: 0,
            updatedAt: 1_000,
            reactions: [],
            votes: [],
          },
        ]),
      ),
    );
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(2));

    expect(requests[0]!.ops).toHaveLength(1);
    expect(requests[1]!.ops).toEqual([{ type: 'react', target: -1, payload: { emoji: '👍' } }]);
    second.resolve(
      result(
        snapshot([
          {
            id: 9,
            title: 't',
            contentMd: 'c',
            sort: 0,
            updatedAt: 1_000,
            reactions: [],
            votes: [],
          },
        ]),
      ),
    );

    await expect(active).resolves.toMatchObject({ ok: true });
    await expect(firstFlush).resolves.toMatchObject({ ok: true });
    await expect(secondFlush).resolves.toMatchObject({ ok: true });
  });

  it('remaps queued temp targets from the snapshot mapping before the follow-up', async () => {
    const first = deferred<SyncCallResult>();
    const second = deferred<SyncCallResult>();
    const requests: SyncRequest[] = [];
    const engine = new SyncEngine({
      db,
      postSyncFn: (body) => {
        requests.push(body);
        return requests.length === 1 ? first.promise : second.promise;
      },
      onSyncResponse: () => new Map([[-1, 9]]),
    });
    await engine.addOp({ type: 'fb_create', payload: { contentMd: 'body' } });
    engine.sync();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const version = await engine.addOp(op(-1));
    const flushed = engine.flushThrough(version);
    first.resolve(
      result(
        snapshot([
          {
            id: 9,
            title: 'new',
            contentMd: 'body',
            sort: 0,
            updatedAt: 1_000,
            reactions: [],
            votes: [],
          },
        ]),
      ),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[1]!.ops).toEqual([{ type: 'react', target: 9, payload: { emoji: '👍' } }]);
    second.resolve(result(snapshot()));
    await expect(flushed).resolves.toMatchObject({ ok: true });
  });

  it('keeps the op queued when its sync attempt fails', async () => {
    const engine = new SyncEngine({
      db,
      postSyncFn: vi.fn().mockRejectedValue(new Error('offline')),
    });
    await engine.addOp({ type: 'like', target: 2 });
    const flushed = await engine.flushThrough(1);

    expect(flushed.ok).toBe(false);
    expect((await readOps(db)).map((entry) => entry.op)).toEqual([{ type: 'like', target: 2 }]);
  });

  it('reports confirmation only through the ops the request actually carried', async () => {
    const engine = new SyncEngine({
      db,
      postSyncFn: vi.fn().mockResolvedValue(result(snapshot())),
    });
    const first = await engine.addOp(op(-1));
    const second = await engine.addOp(op(-2));
    expect(second).toBeGreaterThan(first);

    // confirmedThroughVersion is the last sent op's log key — not an in-memory
    // counter, which would also claim ops excluded from this request (the
    // in-flight pagehide prefix, or ops appended by another tab sharing the oplog).
    await expect(engine.sync()).resolves.toEqual({
      ok: true,
      confirmedThroughVersion: second,
    });
  });
});

describe('SyncEngine in-flight dedup and pagehide flush', () => {
  let sink: ErrorSink;
  let fetchFn: FetchMock;
  let postSyncFn: PostSyncMock;
  /** Every op the default postSync accepted — the runSync-side dedup recorder. */
  let submitted: Op[];
  let windowStub: StubWindow;
  let documentStub: StubDocument;

  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  /**
   * Await an oplog read issued *after* a dispatch. IndexedDB runs same-store
   * transactions in creation order, so by the time this resolves the pagehide
   * dump has finished its send/skip decision — deterministic, no fixed sleeps.
   */
  const pagehideReadDone = async (): Promise<void> => {
    await readOps(db);
  };

  const dumpAndReports = async (
    e: SyncEngine,
  ): Promise<Array<{ phase: string; message: string }>> => {
    firePagehide(e);
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());
    return reports(sink);
  };

  it('install() wires pagehide and a hidden-document visibilitychange', async () => {
    const e = engine();
    e.install(windowStub as unknown as Window);
    await e.addOp(op(-1));

    windowStub.dispatch('pagehide');
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ keepalive: true });

    documentStub.visibilityState = 'hidden';
    documentStub.dispatch('visibilitychange');
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(1));
    expect(postSyncFn.mock.calls[0]![1]).toEqual({ keepalive: true });
  });

  it('does not resubmit ops a pagehide keepalive already carries', async () => {
    const keepalive = deferred<Response>();
    fetchFn.mockImplementation(() => keepalive.promise);
    const e = engine();
    await e.addOp({ type: 'fb_create', payload: { contentMd: 'body' } });
    await e.addOp(op(-1));

    firePagehide(e);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const carried = (JSON.parse(fetchFn.mock.calls[0]![1]?.body as string) as SyncRequest).ops;
    expect(carried).toHaveLength(2);

    await expect(e.sync()).resolves.toMatchObject({ ok: true });
    const carriedJson = new Set(carried.map((o) => JSON.stringify(o)));
    expect(submitted.filter((o) => carriedJson.has(JSON.stringify(o)))).toEqual([]);
    expect(await readOps(db)).toHaveLength(2); // still queued: the keepalive has not settled

    keepalive.resolve(new Response(null, { status: 200 }));
    await vi.waitFor(async () => {
      expect(await readOps(db)).toHaveLength(0);
    });
  });

  it('clears only the ops the keepalive sent when one lands mid-flight', async () => {
    const keepalive = deferred<Response>();
    fetchFn.mockImplementation(() => keepalive.promise);
    const e = engine();
    await e.addOp(op(-1));

    firePagehide(e);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const queued: Op = { type: 'like', target: 2 };
    await e.addOp(queued);

    keepalive.resolve(new Response(null, { status: 200 }));
    await vi.waitFor(async () => {
      expect(await readOps(db)).toHaveLength(1);
    });
    expect((await readOps(db)).map((entry) => entry.op)).toEqual([queued]);
  });

  it('drops an op owned by an active sync from the pagehide dump', async () => {
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
    await vi.waitFor(() => expect(submitted).toEqual([only]));

    firePagehide(e);
    await pagehideReadDone();
    expect(fetchFn).not.toHaveBeenCalled();

    syncCall.resolve(result(snapshot()));
    await expect(attempt).resolves.toMatchObject({ ok: true });
    expect(await readOps(db)).toHaveLength(0);
  });

  it('does not double-send when pagehide fires twice during a keepalive', async () => {
    const keepalive = deferred<Response>();
    fetchFn.mockImplementation(() => keepalive.promise);
    const e = engine();
    await e.addOp(op(-1));

    firePagehide(e);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    firePagehide(e);
    await pagehideReadDone();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    keepalive.resolve(new Response(null, { status: 200 }));
    await vi.waitFor(async () => {
      expect(await readOps(db)).toHaveLength(0);
    });

    firePagehide(e); // nothing queued anymore
    await pagehideReadDone();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  const fetchFailures: Array<{
    name: string;
    arrange: (ctx: ArrangeCtx) => void;
    expected: { phase: string; message: unknown };
  }> = [
    {
      name: 'a synchronously throwing fetch',
      arrange: ({ fetchFn: f }) =>
        f.mockImplementation(() => {
          throw new Error('fetch exploded');
        }),
      expected: { phase: 'pagehide', message: 'fetch exploded' },
    },
    {
      name: 'a rejected keepalive request',
      arrange: ({ fetchFn: f }) => f.mockImplementation(() => Promise.reject(new Error('offline'))),
      expected: { phase: 'pagehide', message: 'offline' },
    },
    {
      name: 'a non-ok response',
      arrange: ({ fetchFn: f }) =>
        f.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 }))),
      expected: { phase: 'pagehide', message: 'pagehide flush rejected: HTTP 500' },
    },
  ];

  it.each(fetchFailures)(
    'reports $name, keeps the op, and lets the next dump retry',
    async ({ arrange, expected }) => {
      const e = engine();
      await e.addOp(op(-1));
      arrange({ db, fetchFn });

      expect(await dumpAndReports(e)).toEqual([expected]);
      expect((await readOps(db)).map((entry) => entry.op)).toEqual([op(-1)]);

      firePagehide(e);
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    },
  );

  const oplogFailures: Array<{
    name: string;
    arrange: (ctx: ArrangeCtx) => void;
    expected: { phase: string; message: unknown };
  }> = [
    {
      name: 'a failed oplog read',
      arrange: ({ db: d }) => {
        d.close();
      },
      expected: { phase: 'pagehide', message: expect.any(String) },
    },
    {
      name: 'a failed oplog clear',
      arrange: ({ db: d, fetchFn: f }) => {
        f.mockImplementation(() => {
          d.close(); // 200 comes back, but the connection the clear needs is gone
          return Promise.resolve(new Response(null, { status: 200 }));
        });
      },
      expected: { phase: 'pagehide', message: expect.any(String) },
    },
  ];

  it.each(oplogFailures)(
    'reports $name instead of swallowing it',
    async ({ arrange, expected }) => {
      const e = engine();
      await e.addOp(op(-1));
      arrange({ db, fetchFn });

      expect(await dumpAndReports(e)).toEqual([expected]);
    },
  );

  it('passes keepalive only for a sync started on a hidden document', async () => {
    const e = engine();
    await e.addOp(op(-1));

    await e.sync();
    expect(postSyncFn.mock.calls[0]![1]).toEqual({ keepalive: false });

    documentStub.visibilityState = 'hidden';
    await e.addOp(op(-2));
    await e.sync();
    expect(postSyncFn.mock.calls[1]![1]).toEqual({ keepalive: true });
  });

  it('falls back to a plain request when a hidden batch busts the keepalive cap', async () => {
    documentStub.visibilityState = 'hidden';
    const e = engine();
    await e.addOp({
      type: 'fb_create',
      payload: { contentMd: 'x'.repeat(KEEPALIVE_BODY_LIMIT) },
    });

    await e.sync();
    expect(postSyncFn.mock.calls[0]![1]).toEqual({ keepalive: false });
    expect(await readOps(db)).toHaveLength(0);
  });
});
