import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Op, SyncRequest, SyncResponse } from '$shared/types';
import type { SyncCallResult, SyncClientIo } from '../../src/core/api/syncClient';
import { clearOps, openOplogDb, readOps } from '../../src/core/oplog/store';
import { SyncEngine } from '../../src/core/sync/engine';

const op = (target: number): Op => ({ type: 'ann_update', target, payload: { title: 't', contentMd: 'c' } });

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

describe('SyncEngine awaitable sync', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openOplogDb();
    await clearOps(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      return;
    }
  });

  it('coalesces callers and flushes an op appended during an in-flight request', async () => {
    const first = deferred<SyncCallResult>();
    const second = deferred<SyncCallResult>();
    const requests: SyncRequest[] = [];
    const postSyncFn = vi.fn((body: SyncRequest) => {
      requests.push(body);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const engine = new SyncEngine({ db, postSyncFn });
    await engine.addOp({ type: 'ann_create', payload: { title: 'new', contentMd: 'body' } });

    const active = engine.sync();
    const coalesced = engine.sync();
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(1));
    expect(coalesced).toBe(active);

    const version = await engine.addOp(op(-1));
    const firstFlush = engine.flushThrough(version);
    const secondFlush = engine.flushThrough(version);
    first.resolve(result(snapshot([{
      id: 9,
      title: 'new',
      contentMd: 'body',
      sort: 0,
      updatedAt: 1_000,
      reactions: [],
      votes: [],
    }])));
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(2));

    expect(requests[0]!.ops).toHaveLength(1);
    expect(requests[1]!.ops).toEqual([{ type: 'ann_update', target: -1, payload: { title: 't', contentMd: 'c' } }]);
    second.resolve(result(snapshot([{
      id: 9,
      title: 't',
      contentMd: 'c',
      sort: 0,
      updatedAt: 1_000,
      reactions: [],
      votes: [],
    }])));

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
    await engine.addOp({ type: 'ann_create', payload: { title: 'new', contentMd: 'body' } });
    const active = engine.sync();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const version = await engine.addOp(op(-1));
    const flushed = engine.flushThrough(version);
    first.resolve(result(snapshot([{
      id: 9,
      title: 'new',
      contentMd: 'body',
      sort: 0,
      updatedAt: 1_000,
      reactions: [],
      votes: [],
    }])));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[1]!.ops).toEqual([{ type: 'ann_update', target: 9, payload: { title: 't', contentMd: 'c' } }]);
    second.resolve(result(snapshot()));
    await expect(flushed).resolves.toMatchObject({ ok: true });
  });

  it('keeps the op queued when its sync attempt fails', async () => {
    const engine = new SyncEngine({
      db,
      postSyncFn: vi.fn().mockRejectedValue(new Error('offline')),
    });
    await engine.addOp({ type: 'ann_reorder', payload: [2, 1] });
    const flushed = await engine.flushThrough(1);

    expect(flushed.ok).toBe(false);
    expect((await readOps(db)).map((entry) => entry.op)).toEqual([
      { type: 'ann_reorder', payload: [2, 1] },
    ]);
  });
});

type PagehideInternals = { flushOnPagehide(): void };

/** The pagehide dump is private; tests reach it through the class contract. */
const triggerPagehide = (engine: SyncEngine): void =>
  (engine as unknown as PagehideInternals).flushOnPagehide();

/** Let IndexedDB transactions and the promise chains on top of them settle. */
const settle = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SyncEngine in-flight dedup and pagehide flush', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openOplogDb();
    await clearOps(db);
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      db.close();
    } catch {
      // the test may have closed the connection itself
    }
  });

  it('does not resubmit ops a pagehide keepalive already carries', async () => {
    const keepalive = deferred<Response>();
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> => keepalive.promise);
    const postSyncFn = vi.fn(
      (_body: SyncRequest, _io?: SyncClientIo): Promise<SyncCallResult> => Promise.resolve(result(snapshot())),
    );
    const engine = new SyncEngine({ db, fetchFn, postSyncFn });
    await engine.addOp({ type: 'ann_create', payload: { title: 'new', contentMd: 'body' } });
    await engine.addOp(op(-1));

    triggerPagehide(engine);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ keepalive: true });
    const body = fetchFn.mock.calls[0]![1]?.body as string;
    expect((JSON.parse(body) as SyncRequest).ops).toHaveLength(2);

    await expect(engine.sync()).resolves.toMatchObject({ ok: true });
    expect(postSyncFn).toHaveBeenCalledTimes(1);
    expect(postSyncFn.mock.calls[0]![0].ops).toEqual([]); // both keys are in flight
    expect(await readOps(db)).toHaveLength(2); // the keepalive has not settled yet

    keepalive.resolve(new Response(null, { status: 200 }));
    await vi.waitFor(async () => {
      expect(await readOps(db)).toHaveLength(0);
    });
    expect(postSyncFn).toHaveBeenCalledTimes(1);
  });

  it('drops an op owned by an active sync from the pagehide dump', async () => {
    const syncCall = deferred<SyncCallResult>();
    const postSyncFn = vi.fn(
      (_body: SyncRequest, _io?: SyncClientIo): Promise<SyncCallResult> => syncCall.promise,
    );
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const engine = new SyncEngine({ db, fetchFn, postSyncFn });
    await engine.addOp(op(-1));

    const attempt = engine.sync();
    await vi.waitFor(() => expect(postSyncFn).toHaveBeenCalledTimes(1));

    triggerPagehide(engine);
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();

    syncCall.resolve(result(snapshot()));
    await expect(attempt).resolves.toMatchObject({ ok: true });
    expect(await readOps(db)).toHaveLength(0);
  });

  it('releases its keys when the keepalive fetch throws synchronously', async () => {
    const onError = vi.fn((_phase: 'submit' | 'pagehide', _error: unknown): void => {});
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> => {
      throw new Error('fetch exploded');
    });
    const engine = new SyncEngine({ db, fetchFn, onError });
    await engine.addOp(op(-1));

    triggerPagehide(engine);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe('pagehide');
    expect((onError.mock.calls[0]![1] as Error).message).toBe('fetch exploded');
    expect(await readOps(db)).toHaveLength(1);

    // Without the release every later flush would skip the key forever.
    triggerPagehide(engine);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it('reports a rejected keepalive and keeps the op for the next flush', async () => {
    const onError = vi.fn((_phase: 'submit' | 'pagehide', _error: unknown): void => {});
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> =>
      Promise.reject(new Error('offline')),
    );
    const engine = new SyncEngine({ db, fetchFn, onError });
    await engine.addOp(op(-1));

    triggerPagehide(engine);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe('pagehide');
    expect((onError.mock.calls[0]![1] as Error).message).toBe('offline');
    expect(await readOps(db)).toHaveLength(1);

    triggerPagehide(engine);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it('reports a non-ok keepalive response instead of dropping it', async () => {
    const onError = vi.fn((_phase: 'submit' | 'pagehide', _error: unknown): void => {});
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> =>
      Promise.resolve(new Response('nope', { status: 500 })),
    );
    const engine = new SyncEngine({ db, fetchFn, onError });
    await engine.addOp(op(-1));

    triggerPagehide(engine);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe('pagehide');
    expect((onError.mock.calls[0]![1] as Error).message).toContain('500');
    expect(await readOps(db)).toHaveLength(1);
  });

  it('reports an oplog clear failure after an accepted keepalive', async () => {
    const onError = vi.fn((_phase: 'submit' | 'pagehide', _error: unknown): void => {});
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> => {
      db.close(); // 200 comes back, but the connection the clear needs is gone
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const engine = new SyncEngine({ db, fetchFn, onError });
    await engine.addOp(op(-1));

    triggerPagehide(engine);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe('pagehide');
  });

  it('reports an oplog read failure during the dump', async () => {
    const onError = vi.fn((_phase: 'submit' | 'pagehide', _error: unknown): void => {});
    const fetchFn = vi.fn((..._args: Parameters<typeof fetch>): Promise<Response> =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const engine = new SyncEngine({ db, fetchFn, onError });
    await engine.addOp(op(-1));
    db.close(); // the guard passes (pending > 0) but the read cannot start

    triggerPagehide(engine);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe('pagehide');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('makes a sync started on a hidden document keepalive so it survives the unload', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const postSyncFn = vi.fn(
      (_body: SyncRequest, _io?: SyncClientIo): Promise<SyncCallResult> => Promise.resolve(result(snapshot())),
    );
    const engine = new SyncEngine({ db, postSyncFn });
    await engine.addOp(op(-1));

    await engine.sync();
    expect(postSyncFn.mock.calls[0]![1]).toEqual({ keepalive: true });
    expect(await readOps(db)).toHaveLength(0);
  });

  it('keeps a sync started on a visible document on a plain request', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const postSyncFn = vi.fn(
      (_body: SyncRequest, _io?: SyncClientIo): Promise<SyncCallResult> => Promise.resolve(result(snapshot())),
    );
    const engine = new SyncEngine({ db, postSyncFn });
    await engine.addOp(op(-1));

    await engine.sync();
    expect(postSyncFn.mock.calls[0]![1]).toEqual({ keepalive: false });
  });
});
