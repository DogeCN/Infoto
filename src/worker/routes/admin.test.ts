// The one admin route that remains on HTTP after ADR 0026: root-gated draft translation.
// The announcement / poll / feedback mutation routes moved to WebSocket ops; their old
// coverage moved to album-ops.test.ts and do/album.test.ts.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { makeApp, stubSiteverify } from '../../testing/app.ts';

stubSiteverify();

test('admin: a translation request writes no row, and only root may ask', async () => {
  const { db, app } = makeApp();
  // Root, seeded directly: identity and album mutations are WebSocket ops now, so there
  // is no HTTP route to mint an identity with.
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (0, 'root', 1);");
  const root = await app.request('http://localhost/admin/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'uuid=root' },
    body: JSON.stringify({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 't',
      contentMd: 'md',
    }),
  });
  // The AI binding is absent in tests, so the route answers 503 — what matters is that it
  // got past the root gate and wrote nothing.
  assert.ok([200, 503].includes(root.status), `unexpected status ${root.status}`);
  const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  assert.equal(users!.n, 1, 'a translation mints no identity');
  const anns = await db.prepare('SELECT COUNT(*) AS n FROM announcements').first<{ n: number }>();
  assert.equal(anns!.n, 0, 'a translation writes no content row');

  // A non-root uuid is refused before anything runs.
  db.exec("INSERT INTO users (id, uuid, created_at) VALUES (1, 'guest', 1);");
  const guest = await app.request('http://localhost/admin/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'uuid=guest' },
    body: JSON.stringify({
      kind: 'announcement',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      title: 't',
      contentMd: 'md',
    }),
  });
  assert.equal(guest.status, 403);
});
