import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { SyncResponse } from '../../shared/types.ts';
import {
  cookieFrom,
  countingDb,
  makeApp,
  postOps,
  stubSiteverify,
  sync,
  syncNew,
} from '../../testing/app.ts';
import type { DbCallCounts } from '../../testing/app.ts';

const setSiteverify = stubSiteverify();

/** When the facade returned the URL. Every upload op must carry one. */
const UPLOADED_AT = 1_700_000_000_000;

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

test('upload keeps the client createdAt, ignores uploader, and stays silent on collisions', async () => {
  const { app } = makeApp();
  const first = await syncNew(app);
  const cookie = cookieFrom(first);
  // When the facade returned the URL. It is the only per-photo timestamp available: the
  // server reads its clock once per request, so a batch would otherwise share one value.
  const uploadedAt = Date.now() - 60_000;
  const payload = {
    sha256: 'abc',
    url: 'https://host/x.webp',
    width: 10,
    height: 20,
    size: 123,
    type: 0,
    createdAt: uploadedAt,
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
  // uploader remains server-authoritative
  assert.equal(json.photos[0]!.uploader, 0);
  // createdAt is the upload's own moment, not the sync's
  assert.equal(json.photos[0]!.createdAt, uploadedAt);
  assert.equal(json.photos[0]!.id, 1);
});

test('upload clamps a future createdAt to the server clock and drops one that is absent', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const before = Date.now();
  const res = await sync(
    app,
    {
      ops: [
        {
          type: 'upload',
          payload: {
            sha256: 'future',
            url: 'https://host/f.webp',
            width: 1,
            height: 1,
            size: 1,
            type: 0,
            createdAt: Date.now() + 86_400_000,
          },
        },
        {
          // No createdAt: an upload with no time of its own is dropped, like any other
          // payload missing a required field.
          type: 'upload',
          payload: {
            sha256: 'undated',
            url: 'https://host/u.webp',
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
  const json = (await res.json()) as SyncResponse;
  assert.deepEqual(
    json.photos.map((p) => p.sha256),
    ['future'],
  );
  assert.ok(json.photos[0]!.createdAt >= before);
  assert.ok(json.photos[0]!.createdAt <= Date.now());
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
          payload: {
            sha256: 'h',
            url: 'https://h',
            width: 1,
            height: 1,
            size: 1,
            type: 0,
            createdAt: UPLOADED_AT,
          },
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
          payload: {
            sha256: 'zz',
            url: 'https://z',
            width: 2,
            height: 2,
            size: 2,
            type: 0,
            createdAt: UPLOADED_AT,
          },
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
          payload: {
            sha256: 'q',
            url: 'https://q',
            width: 1,
            height: 1,
            size: 1,
            type: 0,
            createdAt: UPLOADED_AT,
          },
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
          payload: {
            sha256: 'p',
            url: 'https://p',
            width: 1,
            height: 1,
            size: 1,
            type: 0,
            createdAt: UPLOADED_AT,
          },
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
        { type: 'fb_create', payload: { contentMd: 'hello', locale: 'en-US' } },
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

test('poll votes replace or clear selected options and reject invalid selections', async () => {
  const { app } = makeApp();
  const rootCookie = cookieFrom(await syncNew(app));
  const created = await app.request('http://localhost/admin/polls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: rootCookie },
    body: JSON.stringify({
      options: ['Good', 'Okay', 'Bad'],
      allowMultiple: false,
      locale: 'en-US',
    }),
  });
  assert.equal(created.status, 200);
  const pollId = ((await created.json()) as { poll: { id: number } }).poll.id;
  const guest = cookieFrom(await syncNew(app));

  let snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: pollId, payload: { options: [1] } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.polls[0]!.votes, [{ userId: 1, option: 1 }]);

  snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: pollId, payload: { options: [0] } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.polls[0]!.votes, [{ userId: 1, option: 0 }]);

  snap = (await (
    await sync(app, { ops: [{ type: 'vote', target: pollId, payload: { options: [] } }] }, guest)
  ).json()) as SyncResponse;
  assert.deepEqual(snap.polls[0]!.votes, []);

  snap = (await (
    await sync(
      app,
      {
        ops: [
          { type: 'vote', target: 999, payload: { options: [0] } },
          { type: 'vote', target: pollId, payload: { options: [1.5] } },
          { type: 'vote', target: pollId, payload: { options: [3] } },
          { type: 'vote', target: pollId, payload: { options: [0, 1] } },
          { type: 'vote', target: pollId, payload: { options: [2] } },
        ],
      },
      guest,
    )
  ).json()) as SyncResponse;
  assert.deepEqual(snap.polls[0]!.votes, [{ userId: 1, option: 2 }]);
});

test('announcement reactions and poll votes appear in their respective snapshots', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'a', contentMd: '::poll:en-US:1', locale: 'en-US' }),
  });
  const poll = await app.request('http://localhost/admin/polls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      options: ['A', 'B'],
      allowMultiple: false,
      locale: 'en-US',
    }),
  });
  const pollId = ((await poll.json()) as { poll: { id: number } }).poll.id;
  const res = await sync(
    app,
    {
      ops: [
        { type: 'react', target: 1, payload: { emoji: '👍' } },
        { type: 'vote', target: pollId, payload: { options: [0] } },
      ],
    },
    cookie,
  );
  const json = (await res.json()) as SyncResponse;
  assert.deepEqual(json.announcements[0]!.reactions, [{ userId: 0, emoji: '👍' }]);
  assert.deepEqual(json.polls[0]!.votes, [{ userId: 0, option: 0 }]);
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
        payload: {
          sha256: 'm',
          url: 'https://m',
          width: 1,
          height: 1,
          size: 1,
          type: 0,
          createdAt: UPLOADED_AT,
        },
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
            payload: {
              sha256: url,
              url,
              width: 1,
              height: 1,
              size: 1,
              type: 0,
              createdAt: UPLOADED_AT,
            },
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
            createdAt: UPLOADED_AT,
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
              createdAt: UPLOADED_AT,
            },
          },
        ],
      },
      cookie,
    );
    assert.deepEqual(((await res.json()) as SyncResponse).photos, [], `${width}x${height}`);
  }
});

// Uploads are the external facade's job (README §Media host facade): this Worker holds no
// image-host credential and has no upload route. All it does is name the facade in /sync.
test('the image host is decoupled: no /upload route, facade URL served by /sync', async () => {
  const { app } = makeApp();
  const noAuth = await app.request('http://localhost/upload', { method: 'POST', body: 'x' });
  assert.equal(noAuth.status, 404);
  const cookie = cookieFrom(await syncNew(app));
  const withCookie = await app.request('http://localhost/upload', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=x' },
    body: '--x--',
  });
  assert.equal(withCookie.status, 404);

  // /sync names the configured facade and nothing else: an unset MEDIA_HOST_URL is a
  // misconfiguration, reported as an empty string rather than guessed at.
  const local = await postOps(app, cookie, []);
  assert.equal(((await local.json()) as SyncResponse).mediaHostUrl, '');

  const { app: dev } = makeApp({ mediaHostUrl: 'http://127.0.0.1:8788' });
  const devCookie = cookieFrom(await syncNew(dev));
  const devRes = await postOps(dev, devCookie, []);
  assert.equal(((await devRes.json()) as SyncResponse).mediaHostUrl, 'http://127.0.0.1:8788');

  const { app: deployed } = makeApp({ mediaHostUrl: 'https://facade.example' });
  const deployedCookie = cookieFrom(await syncNew(deployed));
  const res = await postOps(deployed, deployedCookie, []);
  assert.equal(((await res.json()) as SyncResponse).mediaHostUrl, 'https://facade.example');
});

// A locally uploaded photo is plain-HTTP loopback. The write path and the read proxy must
// agree on that, or `npm run dev` loses every upload with no error anywhere.
test('upload ops accept the local simulation URL the read proxy can then serve', async () => {
  const localUrl = 'http://127.0.0.1:8788/abc.webp';
  const uploadOp = (sha: string, url: string) => ({
    type: 'upload' as const,
    target: null,
    payload: { sha256: sha, url, width: 1, height: 1, size: 1, type: 0, createdAt: UPLOADED_AT },
  });

  // MEDIA_HOST_URL pointing at the local simulation (what `.dev.vars` does): the loopback
  // URL is accepted and stored.
  const local = makeApp({ mediaHostUrl: 'http://127.0.0.1:8788' });
  const localCookie = cookieFrom(await syncNew(local.app));
  let snap = (await (
    await postOps(local.app, localCookie, [uploadOp('a'.repeat(64), localUrl)])
  ).json()) as SyncResponse;
  assert.equal(snap.photos.length, 1);
  assert.equal(snap.photos[0]!.url, localUrl);

  // And /l/1 actually serves it, so store and read cannot drift apart.
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response('bytes', { headers: { 'Content-Type': 'image/webp' } });
  };
  try {
    assert.equal((await local.app.request('http://localhost/l/1')).status, 200);
    assert.deepEqual(requested, [localUrl]);
  } finally {
    globalThis.fetch = original;
  }

  // A deployed facade gets the strict rule: the same loopback URL is refused on write.
  const prod = makeApp({ mediaHostUrl: 'https://facade.example' });
  const prodCookie = cookieFrom(await syncNew(prod.app));
  snap = (await (
    await postOps(prod.app, prodCookie, [uploadOp('b'.repeat(64), localUrl)])
  ).json()) as SyncResponse;
  assert.equal(snap.photos.length, 0);

  // An unset facade is a misconfiguration, not local dev: no exception, nothing stored.
  const unset = makeApp();
  const unsetCookie = cookieFrom(await syncNew(unset.app));
  snap = (await (
    await postOps(unset.app, unsetCookie, [uploadOp('d'.repeat(64), localUrl)])
  ).json()) as SyncResponse;
  assert.equal(snap.photos.length, 0);

  // A public HTTPS URL is stored either way.
  const https = makeApp({ mediaHostUrl: 'https://facade.example' });
  const httpsCookie = cookieFrom(await syncNew(https.app));
  snap = (await (
    await postOps(https.app, httpsCookie, [uploadOp('c'.repeat(64), 'https://file.example/x.webp')])
  ).json()) as SyncResponse;
  assert.equal(snap.photos.length, 1);
});

// /admin (the page) is not a Worker route: it falls through to the ASSETS SPA fallback,
// so the root boundary there is frontend-only. Every /admin/* API is server-gated.
test('https Set-Cookie includes Secure; plain http does not', async () => {
  const { app } = makeApp();
  const res = await app.request('https://example.com/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: 'en-US', ops: [], turnstileToken: 'ok' }),
  });
  assert.ok((res.headers.get('set-cookie') ?? '').includes('Secure'));

  const plain = await app.request('http://192.168.1.10/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: 'en-US', ops: [], turnstileToken: 'ok' }),
  });
  assert.ok(!(plain.headers.get('set-cookie') ?? '').includes('Secure'));
});

test('the server owns the like/dislike exclusion, so one op states a switch', async () => {
  const { app } = makeApp();
  const cookie = cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  const up = (ops: Parameters<typeof sync>[1], c: string = cookie): Promise<SyncResponse> =>
    sync(app, ops, c).then((r) => r.json() as Promise<SyncResponse>);
  await up({
    ops: [
      {
        type: 'upload',
        payload: {
          sha256: 's',
          url: 'https://s',
          width: 1,
          height: 1,
          size: 1,
          type: 0,
          createdAt: UPLOADED_AT,
        },
      },
    ],
  });

  // A client that states only the new attitude gets the old one cleared for it.
  const disliked = await up({ ops: [{ type: 'dislike', targetSha: 's' }] });
  assert.deepEqual(disliked.photos[0]!.dislikes, [0]);
  assert.deepEqual(disliked.photos[0]!.likes, []);
  const liked = await up({ ops: [{ type: 'like', targetSha: 's' }] });
  assert.deepEqual(liked.photos[0]!.likes, [0], 'liking adds the like');
  assert.deepEqual(liked.photos[0]!.dislikes, [], 'and clears the dislike in the same statement');

  // A guest switching the other way does not disturb the first user's mark.
  await up({ ops: [{ type: 'dislike', targetSha: 's' }] }, guest);
  const both = await up({ ops: [{ type: 'like', targetSha: 's' }] }, guest);
  assert.deepEqual(both.photos[0]!.likes, [0, 1]);
  assert.deepEqual(both.photos[0]!.dislikes, [], 'only the switching user is cleared');

  // A report is its own dimension: it survives an attitude change in both directions.
  const reported = await up({ ops: [{ type: 'report', targetSha: 's' }] });
  assert.deepEqual(reported.photos[0]!.reports, [0]);
  const flipped = await up({ ops: [{ type: 'dislike', targetSha: 's' }] });
  assert.deepEqual(flipped.photos[0]!.dislikes, [0]);
  assert.deepEqual(flipped.photos[0]!.likes, [1], 'only the switching user leaves the likes');
  assert.deepEqual(flipped.photos[0]!.reports, [0], 'the report stands');

  // Switching clears a column that holds this user alone, which is the removal path's empty
  // case: it must leave '[]', never NULL and never the old entry.
  const lone = await up({ ops: [{ type: 'like', targetSha: 's' }] }, guest);
  assert.deepEqual(lone.photos[0]!.likes, [1], 'the guest is already the only like');
  const switched = await up({ ops: [{ type: 'dislike', targetSha: 's' }] }, guest);
  assert.deepEqual(switched.photos[0]!.likes, [], 'and is gone from likes entirely');
  assert.deepEqual(switched.photos[0]!.dislikes, [0, 1], 'both dislikes stand');
});

// A 200-photo upload is the batch that makes /sync look hung: one round trip per existence
// check plus one per insert multiplies the op count by the D1 round-trip latency, and the page
// gives up before the snapshot comes back. The cost now depends on MAX_BATCH_STATEMENTS, not
// on how many ops the page had queued — asserted as statements and batches, because wall-clock
// time in a unit test measures the machine, not the query plan.
test('a 200-upload batch costs the reads of a small one and a fixed number of writes', async () => {
  const measure = async (count: number): Promise<DbCallCounts> => {
    const counts: DbCallCounts = { queries: 0, batches: 0 };
    const { app } = makeApp({
      mediaHostUrl: 'https://facade.example',
      wrapDb: (db) => countingDb(db, counts).db,
    });
    const cookie = cookieFrom(await syncNew(app));
    // The identity read belongs to the session, not to the batch.
    counts.queries = 0;
    counts.batches = 0;
    const ops = Array.from({ length: count }, (_, i) => ({
      type: 'upload',
      payload: {
        sha256: `sha-${i}`,
        url: `https://file.example/${i}.webp`,
        width: 4,
        height: 3,
        size: 10,
        type: 0,
        createdAt: UPLOADED_AT,
      },
    }));
    const json = (await (await sync(app, { ops }, cookie)).json()) as SyncResponse;
    assert.equal(json.photos.length, count, `${count} uploads landed`);
    return counts;
  };

  const small = await measure(5);
  const large = await measure(200);
  assert.equal(small.batches, 1);
  // 200 statements, batched 100 at a time: the write count is a function of the constant.
  assert.equal(large.batches, 2);
  assert.equal(large.queries, small.queries, 'the read count does not grow with the op count');
});

// Statements keep the order the ops arrived in, and a chunk boundary is invisible to that order:
// a mark that follows the upload creating its row still lands when the upload went out in an
// earlier chunk.
test('ops keep their order across a chunk boundary', async () => {
  const { app } = makeApp({ mediaHostUrl: 'https://facade.example' });
  const cookie = cookieFrom(await syncNew(app));
  const uploads = Array.from({ length: 150 }, (_, i) => ({
    type: 'upload',
    payload: {
      sha256: `sha-${i}`,
      url: `https://file.example/${i}.webp`,
      width: 4,
      height: 3,
      size: 10,
      type: 0,
      createdAt: UPLOADED_AT,
    },
  }));
  const res = await sync(app, { ops: [...uploads, { type: 'like', targetSha: 'sha-0' }] }, cookie);
  const json = (await res.json()) as SyncResponse;
  assert.equal(json.photos.length, 150);
  const liked = json.photos.find((p) => p.sha256 === 'sha-0');
  assert.ok(liked, 'the first upload is in the album');
  assert.deepEqual(liked.likes, [0], 'the like resolved against the row an earlier chunk wrote');
});
