// Tests for the root-only announcement write API (POST|PUT|DELETE /admin/announcements
// + POST /admin/announcements/reorder). Reads come from the /sync snapshot,
// so we assert write effects by re-pulling /sync afterwards.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TestApp } from '../../testSupport.ts';
import { cookieFrom, makeApp, snap, stubSiteverify, syncNew } from '../../testSupport.ts';

stubSiteverify();

async function annCreate(
  app: TestApp,
  cookie: string,
  title: string,
  contentMd: string,
): Promise<Response> {
  return app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title, contentMd }),
  });
}

async function annPut(
  app: TestApp,
  cookie: string,
  id: number | string,
  title: string,
  contentMd: string,
): Promise<Response> {
  return app.request(`http://localhost/admin/announcements/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title, contentMd }),
  });
}

async function annDelete(app: TestApp, cookie: string, id: number | string): Promise<Response> {
  return app.request(`http://localhost/admin/announcements/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

async function annReorder(app: TestApp, cookie: string, ids: unknown): Promise<Response> {
  return app.request('http://localhost/admin/announcements/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ids }),
  });
}

test('root can create; returns real id + sort + empty reactions/votes', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  const res = await annCreate(app, rootCookie, 'a', 'body');
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    ok: true;
    announcement: {
      id: number;
      title: string;
      sort: number;
      reactions: unknown[];
      votes: unknown[];
    };
  };
  assert.equal(data.announcement.id, 1);
  assert.equal(data.announcement.title, 'a');
  assert.equal(data.announcement.sort, 0);
  assert.deepEqual(data.announcement.reactions, []);
  assert.deepEqual(data.announcement.votes, []);
});

test('non-root create → 403', async () => {
  const { app } = makeApp();
  cookieFrom(await syncNew(app)); // root, unused cookie is fine
  const guestCookie = cookieFrom(await syncNew(app));
  const res = await annCreate(app, guestCookie, 'a', 'b');
  assert.equal(res.status, 403);
});

test('create with missing fields → 400', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  const res = await annCreate(app, rootCookie, '', 'b');
  assert.equal(res.status, 400);
  const res2 = await annCreate(app, rootCookie, 'a', '');
  assert.equal(res2.status, 400);
});

test('update existing → 200; update missing → 404', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  await annCreate(app, rootCookie, 'a', 'b');
  const ok = await annPut(app, rootCookie, 1, 'a2', 'b2');
  assert.equal(ok.status, 200);
  const missing = await annPut(app, rootCookie, 999, 'x', 'y');
  assert.equal(missing.status, 404);
});

test('delete cascades reactions + votes', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  await annCreate(app, rootCookie, 'poll', ':::vote 好 | 不好');
  // react + vote go through /sync, targeting the new announcement id 1
  await app.request('http://localhost/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: rootCookie },
    body: JSON.stringify({
      ops: [
        { type: 'react', target: 1, payload: { emoji: '👍' } },
        { type: 'vote', target: 1, payload: { option: 0 } },
      ],
    }),
  });
  const del = await annDelete(app, rootCookie, 1);
  assert.equal(del.status, 200);
  const after = await snap(app, rootCookie);
  assert.equal(after.announcements.length, 0);
  // a fresh announcement has no inherited reactions/votes
  await annCreate(app, rootCookie, 'next', 'n');
  const fresh = await snap(app, rootCookie);
  assert.deepEqual(fresh.announcements[0]!.reactions, []);
  assert.deepEqual(fresh.announcements[0]!.votes, []);
});

test('reorder applies sort by index, strips non-numbers; empty ids → 400', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  await annCreate(app, rootCookie, 'a', '1');
  await annCreate(app, rootCookie, 'b', '2');
  await annCreate(app, rootCookie, 'c', '3');
  const res = await annReorder(app, rootCookie, [3, 'x', null, 1, 2]);
  assert.equal(res.status, 200);
  const after = await snap(app, rootCookie);
  assert.deepEqual(
    after.announcements.map((a) => a.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    after.announcements.map((a) => a.sort),
    [0, 1, 2],
  );
  const empty = await annReorder(app, rootCookie, []);
  assert.equal(empty.status, 400);
  const nonArray = await annReorder(app, rootCookie, { ids: [1] });
  assert.equal(nonArray.status, 400);
});
