import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { LocalDb } from '../../testing/localDb.ts';
import type { TestApp } from '../../testing/app.ts';
import { cookieFrom, makeApp, stubSiteverify, sync, syncNew } from '../../testing/app.ts';
import { MIGRATE_TABLES, parseSqlStatements, restoreOldTables } from './migrate.ts';

stubSiteverify();

async function rootCookie(app: TestApp): Promise<string> {
  const res = await sync(app, {
    turnstileToken: 'ok',
    ops: [
      {
        type: 'upload',
        payload: { sha256: 'aa', url: 'https://h/a.webp', width: 1, height: 1, size: 2, type: 0 },
      },
    ],
  });
  const cookie = cookieFrom(res);
  const created = await app.request('http://localhost/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 't', contentMd: `md\\slash --- ; /* c */ it's` }),
  });
  assert.equal(created.status, 200);
  await sync(
    app,
    {
      ops: [
        { type: 'react', target: 1, payload: { emoji: '🔥' } },
        { type: 'vote', target: 1, payload: { option: 1 } },
        { type: 'fb_create', payload: { contentMd: 'fb' } },
      ],
    },
    cookie,
  );
  return cookie;
}

async function counts(db: LocalDb) {
  const n = async (t: string) =>
    Number((await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first('c')) ?? 0);
  const out: Record<string, number> = {};
  for (const t of MIGRATE_TABLES) out[t] = await n(t);
  return out;
}

test('parseSqlStatements keeps only INSERT', () => {
  const stmts = parseSqlStatements(`
		-- comment
		CREATE TABLE x (id INTEGER);
		INSERT INTO users (id, uuid, created_at) VALUES (0, 'u', 1);
		/* block */
		UPDATE users SET id = 1;
		INSERT INTO feedback (id, user_id, content_md, created_at) VALUES (1, 0, 'x', 2);
	`);
  assert.equal(stmts.length, 2);
  assert.ok(/^INSERT INTO users/i.test(stmts[0]!));
  assert.ok(/^INSERT INTO feedback/i.test(stmts[1]!));
});

test('parseSqlStatements is quote-aware: ; -- /* and quotes inside literals survive', () => {
  const stmts = parseSqlStatements(
    `INSERT INTO announcements (title, content_md) VALUES ('t; --- /* c */', 'it''s -- a; b'); -- trailing`,
  );
  assert.equal(stmts.length, 1);
  assert.equal(
    stmts[0],
    `INSERT INTO announcements (title, content_md) VALUES ('t; --- /* c */', 'it''s -- a; b');`,
  );
});

test('export → import round-trip restores rows', async () => {
  const { db, app } = makeApp();
  const cookie = await rootCookie(app);
  const before = await counts(db);
  assert.equal(before.users, 1);
  assert.equal(before.photos, 1);
  assert.equal(before.announcements, 1);
  assert.equal(before.reactions, 1);
  assert.equal(before.votes, 1);
  assert.equal(before.feedback, 1);

  const dump = await app.request('http://localhost/admin/migrate', { headers: { Cookie: cookie } });
  assert.equal(dump.status, 200);
  assert.equal(dump.headers.get('cache-control'), 'no-store');
  assert.ok((dump.headers.get('content-disposition') ?? '').includes('infoto-export-'));
  const sql = await dump.text();
  assert.ok(sql.includes('CREATE TABLE'));
  assert.ok(sql.includes('INSERT INTO users'));

  await db.prepare("UPDATE announcements SET title = 'mutated'").run();
  const imp = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: sql,
  });
  const text = await imp.text();
  assert.equal(imp.status, 200, text);
  const json = JSON.parse(text) as { ok: boolean; imported: number };
  assert.equal(json.ok, true);
  assert.ok(json.imported >= 4);
  const title = await db
    .prepare('SELECT title FROM announcements')
    .first<{ title: string }>('title');
  assert.equal(title, 't');
  const md = await db
    .prepare('SELECT content_md FROM announcements')
    .first<{ content_md: string }>('content_md');
  assert.equal(
    md,
    `md\\slash --- ; /* c */ it's`,
    'backslash / ; / -- / /* and quotes must survive the round-trip',
  );
  // votes must survive too — it is part of MIGRATE_TABLES and the export dump
  const vote = await db
    .prepare('SELECT option FROM votes WHERE ann_id = 1 AND user_id = 0')
    .first<{ option: number }>('option');
  assert.equal(vote, 1);
  assert.deepEqual(await counts(db), before);
});

test('bad INSERT returns exact statement and leaves all tables intact', async () => {
  const { db, app } = makeApp();
  const cookie = await rootCookie(app);
  const before = await counts(db);
  const dump = await (
    await app.request('http://localhost/admin/migrate', { headers: { Cookie: cookie } })
  ).text();
  const bad = `${dump}\nINSERT INTO photos (id) VALUES (999);\n`;
  const imp = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: bad,
  });
  assert.equal(imp.status, 422);
  const err = (await imp.json()) as {
    ok: boolean;
    error: string;
    statement: string;
    detail: string;
  };
  assert.equal(err.ok, false);
  assert.equal(err.error, 'import_failed');
  assert.ok(/INSERT INTO photos \(id\) VALUES \(999\)/i.test(err.statement));
  assert.deepEqual(await counts(db), before);
  const sha = await db.prepare('SELECT sha256 FROM photos').first<{ sha256: string }>('sha256');
  assert.equal(sha, 'aa');
});

test('restoreOldTables only swaps tables that have _old copies', async () => {
  const { db } = makeApp();
  await db.prepare("INSERT INTO users (id, uuid, created_at) VALUES (0, 'u', 1)").run();
  await db
    .prepare(
      "INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type) VALUES ('s', 'u', 0, 1, 1, 1, 1, 0)",
    )
    .run();
  await db.prepare('ALTER TABLE users RENAME TO users_old').run();
  await db.prepare('ALTER TABLE photos RENAME TO photos_old').run();
  await db.exec(
    `CREATE TABLE users (id INTEGER PRIMARY KEY, uuid TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
		 CREATE TABLE photos (id INTEGER PRIMARY KEY AUTOINCREMENT, sha256 TEXT UNIQUE NOT NULL, url TEXT NOT NULL, uploader INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, type INTEGER NOT NULL, likes TEXT NOT NULL DEFAULT '[]', dislikes TEXT NOT NULL DEFAULT '[]', reports TEXT NOT NULL DEFAULT '[]');`,
  );
  await restoreOldTables(db);
  const names = (
    await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all<{ name: string }>()
  ).results;
  const set = new Set(names.map((r) => r.name));
  for (const t of MIGRATE_TABLES) assert.ok(set.has(t), t);
  assert.ok(!set.has('users_old'));
  assert.ok(!set.has('photos_old'));
  const uuid = await db.prepare('SELECT uuid FROM users').first<{ uuid: string }>('uuid');
  assert.equal(uuid, 'u');
});

test('a second round-trip over an already-swapped database still restores rows', async () => {
  const { db, app } = makeApp();
  const cookie = await rootCookie(app);
  const dump = await (
    await app.request('http://localhost/admin/migrate', { headers: { Cookie: cookie } })
  ).text();
  const imp = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: dump,
  });
  const text = await imp.text();
  assert.equal(imp.status, 200, text);
  assert.equal((await counts(db)).photos, 1);
});

test('empty import is 400', async () => {
  const { app } = makeApp();
  const cookie = await rootCookie(app);
  const empty = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: '   ',
  });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { ok: false, error: 'bad_request' });
});

test('a script without any INSERT is 400', async () => {
  const { app } = makeApp();
  const cookie = await rootCookie(app);
  const res = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: 'DELETE FROM users;',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: 'no_valid_sql' });
});

test('a declared body over the cap is refused before it is read', async () => {
  const { app } = makeApp();
  const cookie = await rootCookie(app);
  const res = await app.request('http://localhost/admin/migrate', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Length': String(64 * 1024 * 1024) },
    body: 'INSERT INTO users (id, uuid, created_at) VALUES (9, "u", 1);',
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: 'payload_too_large' });
});

test('non-root export and import are 403', async () => {
  const { app } = makeApp();
  cookieFrom(await syncNew(app));
  const guest = cookieFrom(await syncNew(app));
  for (const method of ['GET', 'POST'] as const) {
    const res = await app.request('http://localhost/admin/migrate', {
      method,
      headers: { Cookie: guest },
      ...(method === 'POST' ? { body: 'INSERT INTO users (id) VALUES (1);' } : {}),
    });
    assert.equal(res.status, 403, method);
    assert.deepEqual(await res.json(), { ok: false, error: 'forbidden' });
  }
});
