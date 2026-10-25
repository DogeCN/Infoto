import { test } from 'vitest';
import assert from 'node:assert/strict';
import { makeApp } from '../../testing/app.ts';
import { isStorableMediaUrl } from './media.ts';

test('validates media origins, redirect targets, and response isolation', async () => {
  // Media URLs reject local literals, credentials, and trailing-dot local hosts.
  {
    for (const url of [
      'https://[::1]/a',
      'https://[::ffff:127.0.0.1]/a',
      'https://[fc00::1]/a',
      'https://[fe80::1]/a',
      'https://localhost./a',
      'https://host.internal./a',
      'https://127.1/a',
      'https://2130706433/a',
      'https://100.64.0.1/a',
      'https://224.0.0.1/a',
      'https://user:pass@public.example/a',
    ])
      assert.equal(isStorableMediaUrl(url), false, url);
    assert.equal(isStorableMediaUrl('https://[2606:4700::1111]/a'), true);
    assert.equal(isStorableMediaUrl('https://media.example/a.webp'), true);
  }

  // Media proxy checks redirect targets before fetching them.
  {
    const app = mediaApp();
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input, init) => {
      requested.push(String(input));
      assert.equal(init?.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'https://[::1]/secret' } });
    };
    try {
      assert.equal((await app.request('http://localhost/l/1')).status, 404);
      assert.deepEqual(requested, ['https://media.example/a.webp']);
    } finally {
      globalThis.fetch = original;
    }
  }

  // Media proxy follows public redirects but never serves active HTML.
  {
    const app = mediaApp();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () =>
      ++calls === 1
        ? new Response(null, { status: 302, headers: { Location: '/final.webp' } })
        : new Response('<script>alert(1)</script>', { headers: { 'Content-Type': 'text/html' } });
    try {
      const response = await app.request('http://localhost/l/1');
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
      assert.equal(response.headers.get('Content-Type'), 'image/webp');
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.match(response.headers.get('Content-Security-Policy')!, /sandbox/);
    } finally {
      globalThis.fetch = original;
    }
  }
  // The local simulated host is plain-HTTP loopback, which the SSRF guard rejects. The
  // exception is unlocked by configuring the facade *as* the local simulation — what
  // `.dev.vars` does for `npm run dev` — so changing the stand-in's port is a config
  // edit, not a code edit.
  {
    const { db, app: local } = makeApp({ mediaHostUrl: 'http://127.0.0.1:8788' });
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:8788/a.webp', 0, 1, 1, 1, 1, 0)`);
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return new Response('bytes', { headers: { 'Content-Type': 'image/webp' } });
    };
    try {
      assert.equal((await local.request('http://localhost/l/1')).status, 200);
      assert.deepEqual(requested, ['http://127.0.0.1:8788/a.webp']);
    } finally {
      globalThis.fetch = original;
    }
  }

  // The port is config, so a different one works without a code change.
  {
    const { db, app: otherPort } = makeApp({ mediaHostUrl: 'http://127.0.0.1:9999' });
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:9999/a.webp', 0, 1, 1, 1, 1, 0)`);
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return new Response('bytes', { headers: { 'Content-Type': 'image/webp' } });
    };
    try {
      assert.equal((await otherPort.request('http://localhost/l/1')).status, 200);
      assert.deepEqual(requested, ['http://127.0.0.1:9999/a.webp']);
    } finally {
      globalThis.fetch = original;
    }
  }

  // With a real host configured the same loopback URL is refused again.
  {
    const { db, app: prod } = makeApp({ mediaHostUrl: 'https://tc.example' });
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:8788/a.webp', 0, 1, 1, 1, 1, 0)`);
    assert.equal((await prod.request('http://localhost/l/1')).status, 404);
  }

  // An absent facade is a misconfigured deployment, not a local dev: the strict rule
  // applies. Only naming the loopback simulation unlocks the exception.
  {
    const { db, app: unset } = makeApp();
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:8788/a.webp', 0, 1, 1, 1, 1, 0)`);
    assert.equal((await unset.request('http://localhost/l/1')).status, 404);
  }

  // A loopback URL sharing the prefix but not the origin stays refused, even with the
  // local simulation configured.
  {
    const { db, app: prefix } = makeApp({ mediaHostUrl: 'http://127.0.0.1:8788' });
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:8788.evil.example/a.webp', 0, 1, 1, 1, 1, 0)`);
    assert.equal((await prefix.request('http://localhost/l/1')).status, 404);
  }

  // A loopback URL on a different port than the configured simulation is a different
  // origin, and stays refused.
  {
    const { db, app: otherPort } = makeApp({ mediaHostUrl: 'http://127.0.0.1:8788' });
    db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
      VALUES ('t', 'http://127.0.0.1:9999/a.webp', 0, 1, 1, 1, 1, 0)`);
    assert.equal((await otherPort.request('http://localhost/l/1')).status, 404);
  }
});

test('media route: a copied link resolves with or without its trailing slash', async () => {
  // The SPA fallback normalizes trailing slashes for its own routes, so a link pasted as
  // `/l/1/` must not answer a hard 404 for a photo that `/l/1` serves.
  const app = mediaApp();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('img', { headers: { 'Content-Type': 'image/webp' } });
  try {
    for (const path of ['/l/1', '/l/1/']) {
      const response = await app.request(`http://localhost${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('Content-Type'), 'image/webp', path);
    }
  } finally {
    globalThis.fetch = original;
  }
});

function mediaApp() {
  const { db, app } = makeApp();
  db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
    VALUES ('test', 'https://media.example/a.webp', 0, 1, 1, 1, 1, 0)`);
  return app;
}
