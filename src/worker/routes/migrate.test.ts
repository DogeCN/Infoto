import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.ts';
import { openLocalDb, type LocalDb } from '../../local/d1-shim.ts';
import { MIGRATE_TABLES, parseSqlStatements, restoreOldTables, setRenameBatchOk } from './migrate.ts';

const schema = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'schema.sql'), 'utf8');

function make() {
	const db = openLocalDb(':memory:');
	db.exec(schema);
	const app = createApp({ db });
	return { db, app };
}

async function rootCookie(app: ReturnType<typeof createApp>): Promise<string> {
	const res = await app.request('http://localhost/sync', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			ops: [
				{
					type: 'upload',
					payload: { sha256: 'aa', url: 'https://h/a.webp', width: 1, height: 1, size: 2, type: 0 },
				},
				{ type: 'ann_create', payload: { title: 't', contentMd: `md\\slash --- ; /* c */ it's` } },
				{ type: 'react', target: 1, payload: { emoji: '🔥' } },
				{ type: 'fb_create', payload: { contentMd: 'fb' } },
			],
		}),
	});
	const m = (res.headers.get('set-cookie') ?? '').match(/infoto_id=([^;]+)/);
	assert.ok(m);
	return `infoto_id=${m[1]}`;
}

async function counts(db: LocalDb) {
	const n = async (t: string) => Number((await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first('c')) ?? 0);
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
	setRenameBatchOk(null);
	const { db, app } = make();
	const cookie = await rootCookie(app);
	const before = await counts(db);
	assert.equal(before.users, 1);
	assert.equal(before.photos, 1);
	assert.equal(before.announcements, 1);
	assert.equal(before.reactions, 1);
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
	const title = await db.prepare('SELECT title FROM announcements').first<{ title: string }>('title');
	assert.equal(title, 't');
	const md = await db.prepare('SELECT content_md FROM announcements').first<{ content_md: string }>('content_md');
	assert.equal(md, `md\\slash --- ; /* c */ it's`, 'backslash / ; / -- / /* and quotes must survive the round-trip');
	assert.deepEqual(await counts(db), before);
});

test('bad INSERT returns exact statement and leaves five tables intact', async () => {
	setRenameBatchOk(null);
	const { db, app } = make();
	const cookie = await rootCookie(app);
	const before = await counts(db);
	const dump = await (await app.request('http://localhost/admin/migrate', { headers: { Cookie: cookie } })).text();
	const bad = `${dump}\nINSERT INTO photos (id) VALUES (999);\n`;
	const imp = await app.request('http://localhost/admin/migrate', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: bad,
	});
	assert.equal(imp.status, 500);
	const err = (await imp.json()) as { error: string; statement: string; detail: string };
	assert.equal(err.error, 'import failed');
	assert.ok(/INSERT INTO photos \(id\) VALUES \(999\)/i.test(err.statement));
	assert.deepEqual(await counts(db), before);
	const sha = await db.prepare('SELECT sha256 FROM photos').first<{ sha256: string }>('sha256');
	assert.equal(sha, 'aa');
});

test('restoreOldTables only swaps tables that have _old copies', async () => {
	const { db } = make();
	await db.prepare("INSERT INTO users (id, uuid, created_at) VALUES (0, 'u', 1)").run();
	await db.prepare(
		"INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type) VALUES ('s', 'u', 0, 1, 1, 1, 1, 0)",
	).run();
	await db.prepare('ALTER TABLE users RENAME TO users_old').run();
	await db.prepare('ALTER TABLE photos RENAME TO photos_old').run();
	await db.exec(
		`CREATE TABLE users (id INTEGER PRIMARY KEY, uuid TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
		 CREATE TABLE photos (id INTEGER PRIMARY KEY AUTOINCREMENT, sha256 TEXT UNIQUE NOT NULL, url TEXT NOT NULL, uploader INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, type INTEGER NOT NULL, likes TEXT NOT NULL DEFAULT '[]', dislikes TEXT NOT NULL DEFAULT '[]', reports TEXT NOT NULL DEFAULT '[]');`,
	);
	await restoreOldTables(db);
	const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all<{ name: string }>())
		.results;
	const set = new Set(names.map((r) => r.name));
	for (const t of MIGRATE_TABLES) assert.ok(set.has(t), t);
	assert.ok(!set.has('users_old'));
	assert.ok(!set.has('photos_old'));
	const uuid = await db.prepare('SELECT uuid FROM users').first<{ uuid: string }>('uuid');
	assert.equal(uuid, 'u');
});

test('sequential rename path still round-trips', async () => {
	setRenameBatchOk(false);
	const { db, app } = make();
	const cookie = await rootCookie(app);
	const dump = await (await app.request('http://localhost/admin/migrate', { headers: { Cookie: cookie } })).text();
	const imp = await app.request('http://localhost/admin/migrate', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: dump,
	});
	const text = await imp.text();
	assert.equal(imp.status, 200, text);
	setRenameBatchOk(null);
	assert.equal((await counts(db)).photos, 1);
});

test('empty import is 400; oversize is 413', async () => {
	const { app } = make();
	const cookie = await rootCookie(app);
	const empty = await app.request('http://localhost/admin/migrate', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: '   ',
	});
	assert.equal(empty.status, 400);
});
