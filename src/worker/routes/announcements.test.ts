// Tests for the root-only announcement write API (POST|PUT|DELETE /admin/announcements
// + POST /admin/announcements/reorder). Reads still come from the /sync snapshot,
// so we assert write effects by re-pulling /sync afterwards.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.ts';
import { openLocalDb } from '../../local/d1-shim.ts';
import type { SyncResponse } from '../../shared/types.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');

const TEST_SECRET = 'test-secret';

// Siteverify stub (contract: no allow-branch — identity creation always goes
// through verification). Toggle via siteverifySuccess.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const siteverifySuccess = true;
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url === VERIFY_URL) {
    return new Response(JSON.stringify({ success: siteverifySuccess }), { status: 200 });
  }
  return origFetch(input as never, init);
}) as typeof fetch;

function makeApp() {
  const db = openLocalDb(':memory:');
  db.exec(schema);
  const app = createApp({ db, turnstileSecret: TEST_SECRET });
  return { db, app };
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = raw.match(/uuid=([^;]+)/);
  assert.ok(m, 'Set-Cookie uuid');
  return `uuid=${m[1]}`;
}

async function syncNew(app: ReturnType<typeof createApp>): Promise<Response> {
  return app.request('http://localhost/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], turnstileToken: 'ok' }),
  });
}

async function snap(app: ReturnType<typeof createApp>, cookie: string): Promise<SyncResponse> {
  return (await (
    await app.request('http://localhost/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ops: [] }),
    })
  ).json()) as SyncResponse;
}

async function annCreate(
  app: ReturnType<typeof createApp>,
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
  app: ReturnType<typeof createApp>,
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

async function annDelete(
  app: ReturnType<typeof createApp>,
  cookie: string,
  id: number | string,
): Promise<Response> {
  return app.request(`http://localhost/admin/announcements/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

async function annReorder(
  app: ReturnType<typeof createApp>,
  cookie: string,
  ids: unknown,
): Promise<Response> {
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
  // react + vote still ride /sync, targeting the new announcement id 1
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
