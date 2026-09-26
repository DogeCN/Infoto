// Tests for the root-only admin write APIs (/admin/announcements and /admin/feedback).
// Reads come from the /sync snapshot, so write effects are asserted by re-pulling /sync.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TestApp } from '../../testing/app.ts';
import { cookieFrom, makeApp, postOps, snap, stubSiteverify, syncNew } from '../../testing/app.ts';

stubSiteverify();

/** Root identity (id 0) and a guest identity, both created through the siteverify stub. */
async function twoIdentities(app: TestApp): Promise<{ root: string; guest: string }> {
  const root = cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  return { root, guest };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

async function annRequest(
  app: TestApp,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  return app.request(`http://localhost/admin/announcements${path}`, {
    method,
    headers: { ...jsonHeaders, Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const annCreate = (app: TestApp, cookie: string, title: string, contentMd: string) =>
  annRequest(app, 'POST', '', cookie, { title, contentMd });

const annPut = (app: TestApp, cookie: string, id: number | string, title: string, md: string) =>
  annRequest(app, 'PUT', `/${id}`, cookie, { title, contentMd: md });

const annDelete = (app: TestApp, cookie: string, id: number | string) =>
  annRequest(app, 'DELETE', `/${id}`, cookie);

const annReorder = (app: TestApp, cookie: string, ids: unknown) =>
  annRequest(app, 'POST', '/reorder', cookie, { ids });

const fbDelete = (app: TestApp, cookie: string, id: number | string) =>
  app.request(`http://localhost/admin/feedback/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });

const fbReorder = (app: TestApp, cookie: string, ids: unknown) =>
  app.request('http://localhost/admin/feedback/reorder', {
    method: 'POST',
    headers: { ...jsonHeaders, Cookie: cookie },
    body: JSON.stringify({ ids }),
  });

test('root create returns real id + sort + empty reactions/votes', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  const res = await annCreate(app, root, 'a', 'body');
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    announcement: { id: number; title: string; sort: number; reactions: []; votes: [] };
  };
  assert.equal(data.announcement.id, 1);
  assert.equal(data.announcement.title, 'a');
  assert.equal(data.announcement.sort, 0);
  assert.deepEqual(data.announcement.reactions, []);
  assert.deepEqual(data.announcement.votes, []);
});

test('create rejects a missing or blank field', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  assert.equal((await annCreate(app, root, '', 'b')).status, 400);
  assert.equal((await annCreate(app, root, 'a', '')).status, 400);
});

test('update existing → 200; update missing → 404', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  await annCreate(app, root, 'a', 'b');
  assert.equal((await annPut(app, root, 1, 'a2', 'b2')).status, 200);
  assert.equal((await annPut(app, root, 999, 'x', 'y')).status, 404);
  const after = await snap(app, root);
  assert.equal(after.announcements[0]!.title, 'a2');
});

test('delete cascades reactions and votes', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  await annCreate(app, root, 'poll', ':::vote 好 | 不好');
  await postOps(app, root, [
    { type: 'react', target: 1, payload: { emoji: '👍' } },
    { type: 'vote', target: 1, payload: { option: 0 } },
  ]);
  assert.equal((await annDelete(app, root, 1)).status, 200);
  assert.equal((await snap(app, root)).announcements.length, 0);
  await annCreate(app, root, 'next', 'n');
  const fresh = await snap(app, root);
  assert.deepEqual(fresh.announcements[0]!.reactions, []);
  assert.deepEqual(fresh.announcements[0]!.votes, []);
});

test('reorder assigns sort by index and drops non-ids; empty ids → 400', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  for (const t of ['a', 'b', 'c']) await annCreate(app, root, t, t);
  const res = await annReorder(app, root, [3, 'x', null, 1, 2, 3]);
  assert.equal(res.status, 200);
  const after = await snap(app, root);
  assert.deepEqual(
    after.announcements.map((a) => a.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    after.announcements.map((a) => a.sort),
    [0, 1, 2],
  );
  assert.equal((await annReorder(app, root, [])).status, 400);
  assert.equal((await annReorder(app, root, { ids: [1] })).status, 400);
});

test('a partial reorder still renumbers the whole list', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  for (const t of ['a', 'b', 'c']) await annCreate(app, root, t, t);
  assert.equal((await annReorder(app, root, [3])).status, 200);
  const after = await snap(app, root);
  assert.deepEqual(
    after.announcements.map((a) => a.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    after.announcements.map((a) => a.sort),
    [0, 1, 2],
    'sort must stay gapless so ordering is deterministic',
  );
});

test('non-root writes → 403 on every admin route', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  await annCreate(app, root, 'a', 'b');
  await postOps(app, guest, [{ type: 'fb_create', payload: { contentMd: 'hi' } }]);
  assert.equal((await annCreate(app, guest, 'a', 'b')).status, 403);
  assert.equal((await annPut(app, guest, 1, 'x', 'y')).status, 403);
  assert.equal((await annDelete(app, guest, 1)).status, 403);
  assert.equal((await annReorder(app, guest, [1])).status, 403);
  assert.equal((await fbDelete(app, guest, 1)).status, 403);
  assert.equal((await fbReorder(app, guest, [1])).status, 403);
});

test('a non-numeric :id is rejected, an unknown one is idempotent', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  for (const id of ['abc', '0', '-1', '0x10', '1e3', '1.5']) {
    assert.equal((await fbDelete(app, root, id)).status, 400, id);
  }
  assert.equal((await fbDelete(app, root, 999)).status, 200);
});

test('new feedback lands on top, then reorder assigns sort by index', async () => {
  const { app } = makeApp();
  const { root } = await twoIdentities(app);
  await postOps(app, root, [
    { type: 'fb_create', payload: { contentMd: 'a' } },
    { type: 'fb_create', payload: { contentMd: 'b' } },
    { type: 'fb_create', payload: { contentMd: 'c' } },
  ]);
  const before = await snap(app, root);
  assert.deepEqual(
    before.feedback.map((f) => f.contentMd),
    ['c', 'b', 'a'],
  );

  const ids = before.feedback.map((f) => f.id);
  assert.equal((await fbReorder(app, root, [ids[2], ids[0], ids[1]])).status, 200);
  const after = await snap(app, root);
  assert.deepEqual(
    after.feedback.map((f) => f.id),
    [ids[2], ids[0], ids[1]],
  );
  assert.deepEqual(
    after.feedback.map((f) => f.sort),
    [0, 1, 2],
  );

  await postOps(app, root, [{ type: 'fb_create', payload: { contentMd: 'new' } }]);
  assert.equal((await snap(app, root)).feedback[0]!.contentMd, 'new');
});

test('feedback delete removes the row from the snapshot', async () => {
  const { app } = makeApp();
  const { root, guest } = await twoIdentities(app);
  await postOps(app, guest, [{ type: 'fb_create', payload: { contentMd: 'hi' } }]);
  const before = await snap(app, root);
  assert.equal(before.feedback.length, 1);
  assert.equal((await fbDelete(app, root, before.feedback[0]!.id)).status, 200);
  assert.equal((await snap(app, root)).feedback.length, 0);
});
