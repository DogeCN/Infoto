import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { SyncResponse } from '../../shared/types.ts';
import { cookieFrom, makeApp, stubSiteverify, sync, syncNew } from '../../testSupport.ts';

const setSiteverify = stubSiteverify();

test('no token → 401 turnstile_required; secret-less deployments fail closed (no allow branch)', async () => {
  const { app } = makeApp();
  const res = await sync(app, { ops: [] });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: 'turnstile_required',
    turnstileSiteKey: null,
  });

  // a token against a secret-less deployment must NOT slip through either
  const { app: bare } = makeApp({ turnstileSecret: undefined });
  const res2 = await sync(bare, { ops: [], turnstileToken: 'ok' });
  assert.equal(res2.status, 401);
  assert.deepEqual(await res2.json(), { ok: false, error: 'turnstile_failed' });
});

test('first identity: fake token ok, selfId 0, camelCase, no users, empty feedback', async () => {
  const { app } = makeApp();
  const res = await syncNew(app);
  assert.equal(res.status, 200);
  const json = (await res.json()) as SyncResponse & { users?: unknown; reactions?: unknown };
  assert.equal(json.ok, true);
  assert.equal(json.selfId, 0);
  assert.equal(typeof json.serverTime, 'number');
  assert.deepEqual(json.photos, []);
  assert.deepEqual(json.announcements, []);
  assert.deepEqual(json.feedback, []);
  assert.equal('users' in json, false);
  assert.equal('reactions' in json, false);
  const set = res.headers.get('set-cookie') ?? '';
  assert.ok(set.includes('HttpOnly'));
  assert.ok(set.includes('SameSite=Lax'));
  assert.ok(!set.includes('Secure'));
});

test('secret configured, no token → turnstile_required', async () => {
  const { app } = makeApp({ turnstileSecret: 'sk' });
  const res = await sync(app, { ops: [] });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: 'turnstile_required',
    turnstileSiteKey: null,
  });
});

test('body uuid is ignored; still requires turnstile', async () => {
  const { app } = makeApp({ turnstileSecret: 'sk', turnstileSiteKey: 'site-key' });
  const res = await sync(app, { uuid: '00000000-0000-4000-8000-000000000000', ops: [] });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: 'turnstile_required',
    turnstileSiteKey: 'site-key',
  });
});

test('bad turnstile token → turnstile_failed', async () => {
  setSiteverify(false);
  try {
    const { app } = makeApp();
    const res = await sync(app, { turnstileToken: 'bad', ops: [] });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: 'turnstile_failed' });
  } finally {
    setSiteverify(true);
  }
});

test('upload, sha collision silent, missing fields silent, created_at/uploader ignored', async () => {
  const { app } = makeApp();
  const first = await syncNew(app);
  const cookie = cookieFrom(first);
  const payload = {
    sha256: 'abc',
    url: 'https://host/x.webp',
    width: 10,
    height: 20,
    size: 123,
    type: 0,
    created_at: 1,
    uploader: 99,
  };
  const res = await sync(
    app,
    {
      ops: [
        { type: 'upload', payload },
        { type: 'upload', payload },
        { type: 'upload', payload: { sha256: 'nope' } },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.photos.length, 1);
  assert.equal(json.photos[0]!.sha256, 'abc');
  assert.equal(json.photos[0]!.uploader, 0);
  assert.notEqual(json.photos[0]!.createdAt, 1);
  assert.equal(typeof json.photos[0]!.createdAt, 'number');
  assert.equal(json.photos[0]!.id, 1);
});

test('unupload is discarded; like from same batch still applies', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const res = await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: { sha256: 'h', url: 'https://h', width: 1, height: 1, size: 1, type: 0 },
        },
        { type: 'unupload' as unknown as 'like', target: 1 },
        { type: 'like', target: 1 },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.photos.length, 1);
  assert.deepEqual(json.photos[0]!.likes, [0]);
});

test('non-root announcement create → 403; like in same batch works; feedback hidden', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: { sha256: 'p', url: 'https://p', width: 1, height: 1, size: 1, type: 0 },
        },
      ],
    },
    rootCookie,
  );
  const guest = await syncNew(app);
  assert.equal(((await guest.json()) as SyncResponse).selfId, 1);
  const guestCookie = cookieFrom(guest);
  // the announcement write API is root-only; a guest is rejected, not silently
  // queued (ann_create is not an /sync op)
  const forbidden = await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    body: JSON.stringify({ title: 't', contentMd: 'c' }),
  });
  assert.equal(forbidden.status, 403);
  const res = await sync(
    app,
    {
      ops: [
        { type: 'delete', target: 1 },
        { type: 'like', target: 1 },
        { type: 'fb_create', payload: { contentMd: 'hello' } },
      ],
    },
    guestCookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.selfId, 1);
  assert.equal(json.photos.length, 1);
  assert.deepEqual(json.photos[0]!.likes, [1]);
  assert.deepEqual(json.announcements, []);
  assert.deepEqual(json.feedback, []);
  const asRoot = (await (await syncNew(app, rootCookie)).json()) as SyncResponse;
  assert.equal(asRoot.feedback.length, 1);
  assert.equal(asRoot.feedback[0]!.userId, 1);
  assert.equal(asRoot.feedback[0]!.contentMd, 'hello');
});

test('announcements via admin API: create embeds reactions; update missing → 404; reorder; delete cascades', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));

  // create through the dedicated admin API (ann_create is not an /sync op)
  const createdA = await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'a', contentMd: '1' }),
  });
  assert.equal(createdA.status, 200);
  const a = (await createdA.json()) as { ok: true; announcement: { id: number } };
  assert.equal(a.announcement.id, 1);
  await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'b', contentMd: '2' }),
  });

  // react goes through /sync; the reaction embeds into the announcement snapshot
  await sync(app, { ops: [{ type: 'react', target: 1, payload: { emoji: '👍' } }] }, cookie);
  const mid = (await (await sync(app, { ops: [] }, cookie)).json()) as SyncResponse;
  assert.equal(mid.announcements.length, 2);
  assert.deepEqual(mid.announcements[0]!.reactions, [{ userId: 0, emoji: '👍' }]);
  assert.equal(mid.announcements[0]!.contentMd, '1');
  assert.equal(mid.announcements[0]!.title, 'a');

  // updating a nonexistent id is a 404
  const missing = await app.request('http://localhost/admin/announcements/999', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'x', contentMd: 'y' }),
  });
  assert.equal(missing.status, 404);

  // reorder strips non-positive/non-number ids, applying sort by index
  const reorder = await app.request('http://localhost/admin/announcements/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ids: [2, 'x', null, 1] }),
  });
  assert.equal(reorder.status, 200);
  const reordered = (await (await sync(app, { ops: [] }, cookie)).json()) as SyncResponse;
  assert.deepEqual(
    reordered.announcements.map((ann) => ann.id),
    [2, 1],
  );
  assert.deepEqual(
    reordered.announcements.map((ann) => ann.sort),
    [0, 1],
  );

  // delete cascades reactions + votes
  const del = await app.request('http://localhost/admin/announcements/1', {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  assert.equal(del.status, 200);
  const afterDel = (await (await sync(app, { ops: [] }, cookie)).json()) as SyncResponse;
  assert.equal(afterDel.announcements.length, 1);
  assert.deepEqual(afterDel.announcements[0]!.reactions, []);
});

test('vote: cast / overwrite / retract; nonexistent target skipped; ann_delete cascades', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  // announcement creation goes through the admin API (ann_create is not an /sync op)
  const poll = await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: rootCookie },
    body: JSON.stringify({ title: 'poll', contentMd: ':::vote 好 | 不好' }),
  });
  assert.equal(poll.status, 200);
  const guest = cookieFrom(await syncNew(app));

  // any user may vote; target = announcement id, option = 0-based choice
  let snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: 1 } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 1 }]);

  // re-vote overwrites the single per-user row
  snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: 0 } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 0 }]);

  // option null retracts; a second retract is a silent no-op
  snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: null } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.announcements[0]!.votes, []);
  snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: 1, payload: { option: null } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.announcements[0]!.votes, []);

  // nonexistent announcement → silently skipped (no orphan rows);
  // malformed option (non-integer) → silently dropped
  snap = (await (
    await sync(
      app,
      {
        ops: [
          { type: 'vote', target: 999, payload: { option: 0 } },
          { type: 'vote', target: 1, payload: { option: 1.5 } },
          { type: 'vote', target: 1, payload: { option: 1 } },
        ],
      },
      guest,
    )
  ).json()) as SyncResponse;
  assert.deepEqual(snap.announcements[0]!.votes, [{ userId: 1, option: 1 }]);

  // deletion cascades the votes rows too (it goes through the admin API)
  const del = await app.request('http://localhost/admin/announcements/1', {
    method: 'DELETE',
    headers: { Cookie: rootCookie },
  });
  assert.equal(del.status, 200);
  snap = (await (await sync(app, { ops: [] }, rootCookie)).json()) as SyncResponse;
  assert.equal(snap.announcements.length, 0);
  const next = await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: rootCookie },
    body: JSON.stringify({ title: 'next', contentMd: 'n' }),
  });
  assert.equal(next.status, 200);
  const fresh = (await (await syncNew(app, rootCookie)).json()) as SyncResponse;
  assert.deepEqual(fresh.announcements[0]!.votes, []);
  assert.deepEqual(fresh.announcements[0]!.reactions, []);
});

test('upload without multipart → 400; no cookie → 401', async () => {
  const { app } = makeApp();
  const noAuth = await app.request('http://localhost/upload', { method: 'POST', body: 'x' });
  assert.equal(noAuth.status, 401);
  const cookie = cookieFrom(await syncNew(app));
  const badCt = await app.request('http://localhost/upload', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(badCt.status, 400);
  assert.deepEqual(await badCt.json(), { ok: false, error: 'bad_content_type' });
  const noSecret = await app.request('http://localhost/upload', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=x' },
    body: '--x--',
  });
  assert.equal(noSecret.status, 500);
  assert.deepEqual(await noSecret.json(), { ok: false, error: 'tc_secret_missing' });
});

// /admin (the page) is not a Worker route — it falls through to the ASSETS SPA
// fallback and the root boundary is frontend-only. Only /admin/migrate is
// server-gated (custom 404 for non-root).
test('non-root migrate is custom 404', async () => {
  const { app } = makeApp();
  cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  const res = await app.request('http://localhost/admin/migrate', { headers: { Cookie: guest } });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.ok(html.includes('404'));
});

test('https Set-Cookie includes Secure', async () => {
  const { app } = makeApp();
  const res = await app.request('https://example.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], turnstileToken: 'ok' }),
  });
  const set = res.headers.get('set-cookie') ?? '';
  assert.ok(set.includes('Secure'));
});
