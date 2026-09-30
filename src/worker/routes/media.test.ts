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
});

function mediaApp() {
  const { db, app } = makeApp();
  db.exec(`INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
    VALUES ('test', 'https://media.example/a.webp', 0, 1, 1, 1, 1, 0)`);
  return app;
}
