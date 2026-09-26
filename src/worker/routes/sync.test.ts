import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { SyncResponse } from '../../shared/types.ts';
import { cookieFrom, makeApp, stubSiteverify, sync, syncNew } from '../../testing/app.ts';

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

test('unknown op is discarded; a hash-addressed like from the same batch applies', async () => {
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
        { type: 'unupload' as unknown as 'like', targetSha: 'h' },
        // Photo ops address the photo by its sha256 — the stable unique index. A numeric
        // id is only the external /l/{id36} link, and an in-flight upload has none yet.
        { type: 'like', targetSha: 'h' },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.photos.length, 1);
  assert.deepEqual(json.photos[0]!.likes, [0]);
});

test('photo ops are addressed by sha256; a wrong id target is inert', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const res = await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: { sha256: 'zz', url: 'https://z', width: 2, height: 2, size: 2, type: 0 },
        },
        // The numeric id is only the external /l/{id36} link index: a photo op must not
        // resolve through it, so this is inert even though the row's id happens to be 1.
        { type: 'like', target: 1 },
        { type: 'like', targetSha: 'zz' },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.photos.length, 1);
  // One mark only: the id-addressed op never applied.
  assert.deepEqual(json.photos[0]!.likes, [0]);
});

test('a mark queued while the photo was still uploading applies once the row exists', async () => {
  // The op arrives in the SAME batch, after the upload op that creates the row — the
  // order /sync replays in is the whole contract.
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const res = await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: { sha256: 'q', url: 'https://q', width: 1, height: 1, size: 1, type: 0 },
        },
        { type: 'report', targetSha: 'q' },
        { type: 'delete', targetSha: 'q' },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  // delete after report: the row is gone, so nothing is left to report on.
  assert.deepEqual(json.photos, []);
});

test('a hash-addressed op for an unknown sha is skipped (never creates an orphan)', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const res = await sync(
    app,
    {
      ops: [
        { type: 'like', targetSha: 'never-existed' },
        { type: 'delete', targetSha: 'never-existed' },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.deepEqual(json.photos, []);
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
        // A guest is not root: the delete is refused, the like still lands.
        { type: 'delete', targetSha: 'p' },
        { type: 'like', targetSha: 'p' },
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

test('react and vote embed into the announcement snapshot', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'a', contentMd: '1' }),
  });
  const res = await sync(
    app,
    {
      ops: [
        { type: 'react', target: 1, payload: { emoji: '👍' } },
        { type: 'vote', target: 1, payload: { option: 0 } },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.deepEqual(json.announcements[0]!.reactions, [{ userId: 0, emoji: '👍' }]);
  assert.deepEqual(json.announcements[0]!.votes, [{ userId: 0, option: 0 }]);
});

test('an op list over the per-request cap is refused with 413', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const ops = Array.from({ length: 501 }, () => ({ type: 'like', targetSha: 'x' }));
  const res = await sync(app, { ops }, cookie);
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: 'too_many_ops' });
});

test('a repeated mark is idempotent in both directions', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  const up = (ops: Parameters<typeof sync>[1], c: string = cookie): Promise<SyncResponse> =>
    sync(app, ops, c).then((r) => r.json() as Promise<SyncResponse>);

  await up({
    ops: [
      {
        type: 'upload',
        payload: { sha256: 'm', url: 'https://m', width: 1, height: 1, size: 1, type: 0 },
      },
    ],
  });
  const marked = await up({
    ops: [
      { type: 'like', targetSha: 'm' },
      { type: 'like', targetSha: 'm' },
    ],
  });
  assert.deepEqual(marked.photos[0]!.likes, [0], 'liking twice stores one entry');

  const guestLikes = await up(
    {
      ops: [
        { type: 'like', targetSha: 'm' },
        { type: 'like', targetSha: 'm' },
      ],
    },
    guest,
  );
  assert.deepEqual(guestLikes.photos[0]!.likes, [0, 1]);

  const unmarked = await up({ ops: [{ type: 'unlike', targetSha: 'm' }] }, guest);
  assert.deepEqual(unmarked.photos[0]!.likes, [0], 'unliking removes only that user');
  const again = await up({ ops: [{ type: 'unlike', targetSha: 'm' }] }, guest);
  assert.deepEqual(again.photos[0]!.likes, [0]);
});

test('a stored media URL must be a public https address', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const rejected = [
    'http://host/x.webp',
    'https://127.0.0.1/x.webp',
    'https://10.1.2.3/x.webp',
    'https://192.168.0.5/x.webp',
    'https://169.254.1.1/x.webp',
    'https://localhost/x.webp',
    'https://box.local/x.webp',
    'not a url',
  ];
  for (const url of rejected) {
    const res = await sync(
      app,
      {
        ops: [
          {
            type: 'upload',
            payload: { sha256: url, url, width: 1, height: 1, size: 1, type: 0 },
          },
        ],
      },
      cookie,
    );
    const json = (await res.json()) as SyncResponse;
    assert.deepEqual(json.photos, [], url);
  }
  const ok = await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: {
            sha256: 'good',
            url: 'https://cdn.example.com/x.webp',
            width: 1,
            height: 1,
            size: 1,
            type: 0,
          },
        },
      ],
    },
    cookie,
  );
  assert.equal(((await ok.json()) as SyncResponse).photos.length, 1);
});

test('negative and fractional media metadata is rejected', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  for (const [width, height, size] of [
    [-1, 1, 1],
    [1, -1, 1],
    [1, 1, -1],
    [1.5, 1, 1],
  ] as const) {
    const res = await sync(
      app,
      {
        ops: [
          {
            type: 'upload',
            payload: {
              sha256: `${width}-${height}-${size}`,
              url: 'https://m',
              width,
              height,
              size,
              type: 0,
            },
          },
        ],
      },
      cookie,
    );
    assert.deepEqual(((await res.json()) as SyncResponse).photos, [], `${width}x${height}`);
  }
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

// /admin (the page) is not a Worker route: it falls through to the ASSETS SPA fallback,
// so the root boundary there is frontend-only. Every /admin/* API is server-gated.
test('https Set-Cookie includes Secure; plain http does not', async () => {
  const { app } = makeApp();
  const res = await app.request('https://example.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], turnstileToken: 'ok' }),
  });
  assert.ok((res.headers.get('set-cookie') ?? '').includes('Secure'));

  const plain = await app.request('http://192.168.1.10/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [], turnstileToken: 'ok' }),
  });
  assert.ok(!(plain.headers.get('set-cookie') ?? '').includes('Secure'));
});
