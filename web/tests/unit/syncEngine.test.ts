import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Op, SyncRequest, SyncResponse } from '$shared/types';
import type { SyncCallResult } from '../../src/core/api/syncClient';
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
