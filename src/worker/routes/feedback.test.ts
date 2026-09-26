// Tests for the root-only feedback moderation API (DELETE /admin/feedback/:id).
// Creation goes through /sync's fb_create and reads come from the /sync
// snapshot, so write effects are asserted by re-pulling /sync afterwards.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TestApp } from '../../testSupport.ts';
import { cookieFrom, makeApp, postOps, snap, stubSiteverify, syncNew } from '../../testSupport.ts';

stubSiteverify();

async function fbDelete(app: TestApp, cookie: string, id: number | string): Promise<Response> {
  return app.request(`http://localhost/admin/feedback/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

async function fbReorder(app: TestApp, cookie: string, ids: unknown): Promise<Response> {
  return app.request('http://localhost/admin/feedback/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ids }),
  });
}

test('root delete removes the row from the snapshot', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  const guestCookie = cookieFrom(await syncNew(app));
  // A visitor posts their own feedback through /sync (the creation path).
  await postOps(app, guestCookie, [{ type: 'fb_create', payload: { contentMd: 'hi' } }]);
  const before = await snap(app, rootCookie);
  assert.equal(before.feedback.length, 1);

  const del = await fbDelete(app, rootCookie, before.feedback[0]!.id);
  assert.equal(del.status, 200);
  const after = await snap(app, rootCookie);
  assert.equal(after.feedback.length, 0);
});

test('non-root delete → 403', async () => {
  const { app } = makeApp();
  cookieFrom(await syncNew(app)); // root, unused cookie is fine
  const guestCookie = cookieFrom(await syncNew(app));
  const res = await fbDelete(app, guestCookie, 1);
  assert.equal(res.status, 403);
});

test('new feedback lands on top, then reorder assigns sort by index', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  await postOps(app, rootCookie, [
    { type: 'fb_create', payload: { contentMd: 'a' } },
    { type: 'fb_create', payload: { contentMd: 'b' } },
    { type: 'fb_create', payload: { contentMd: 'c' } },
  ]);
  const before = await snap(app, rootCookie);
  // Each insert takes one below the current minimum sort → newest first.
  assert.deepEqual(
    before.feedback.map((f) => f.contentMd),
    ['c', 'b', 'a'],
  );

  const ids = before.feedback.map((f) => f.id);
  const res = await fbReorder(app, rootCookie, [ids[2], ids[0], ids[1]]);
  assert.equal(res.status, 200);
  const after = await snap(app, rootCookie);
  assert.deepEqual(
    after.feedback.map((f) => f.id),
    [ids[2], ids[0], ids[1]],
  );
  assert.deepEqual(
    after.feedback.map((f) => f.sort),
    [0, 1, 2],
  );

  // A submission arriving after a manual order still goes to the top.
  await postOps(app, rootCookie, [{ type: 'fb_create', payload: { contentMd: 'new' } }]);
  const topped = await snap(app, rootCookie);
  assert.equal(topped.feedback[0]!.contentMd, 'new');
});

test('reorder strips non-numbers; empty ids → 400; non-root → 403', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  const guestCookie = cookieFrom(await syncNew(app));
  await postOps(app, rootCookie, [{ type: 'fb_create', payload: { contentMd: 'a' } }]);
  assert.equal((await fbReorder(app, rootCookie, [])).status, 400);
  assert.equal((await fbReorder(app, rootCookie, { ids: [1] })).status, 400);
  assert.equal((await fbReorder(app, guestCookie, [1])).status, 403);
});

test('invalid id → 400; missing id → 200 (idempotent)', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  assert.equal((await fbDelete(app, rootCookie, 'abc')).status, 400);
  assert.equal((await fbDelete(app, rootCookie, 0)).status, 400);
  assert.equal((await fbDelete(app, rootCookie, 999)).status, 200);
});
