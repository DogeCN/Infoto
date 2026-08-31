// GET|POST /admin/migrate — SQL export / import (rename-swap). Root only.

import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import type { Db } from '../db.ts';
import { ROOT_ID, resolveUser } from '../identity.ts';
import { notFoundPage } from '../errors.ts';
import { CREATE_TABLE_SQL, SCHEMA_SQL } from '../schema-ddl.ts';

export const MIGRATE_TABLES = ['users', 'photos', 'announcements', 'reactions', 'feedback'] as const;

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const CHUNK = 100;

async function requireRoot(env: AppEnv, c: Context) {
	const user = await resolveUser(env.db, c.req.header('cookie'));
	if (!user || user.id !== ROOT_ID) return null;
	return user;
}

export function escapeSql(s: unknown): string {
	// SQLite string literals have no backslash escapes — doubling single quotes is the only escaping.
	return String(s ?? '').replace(/'/g, "''");
}

export function parseSqlStatements(sql: string): string[] {
	const stmts: string[] = [];
	let cur = '';
	let inStr = false;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i]!;
		if (inStr) {
			cur += ch;
			if (ch === "'") {
				if (sql[i + 1] === "'") {
					cur += "'"; // '' escape inside a literal — keep verbatim
					i++;
				} else {
					inStr = false;
				}
			}
			continue;
		}
		if (ch === "'") {
			inStr = true;
			cur += ch;
			continue;
		}
		if (ch === '-' && sql[i + 1] === '-') {
			while (i < sql.length && sql[i] !== '\n') i++; // line comment, outside literals only
			cur += ' ';
			continue;
		}
		if (ch === '/' && sql[i + 1] === '*') {
			const end = sql.indexOf('*/', i + 2);
			i = end === -1 ? sql.length : end + 1; // block comment, outside literals only
			cur += ' ';
			continue;
		}
		if (ch === ';') {
			const s = cur.trim();
			if (s) stmts.push(s.endsWith(';') ? s : `${s};`);
			cur = '';
			continue;
		}
		cur += ch;
	}
	const tail = cur.trim();
	if (tail) stmts.push(tail.endsWith(';') ? tail : `${tail};`);
	return stmts.filter((s) => /^insert\s+into/i.test(s));
}

export async function restoreOldTables(db: Db): Promise<void> {
	for (const t of MIGRATE_TABLES) {
		const hasOld = await db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
			.bind(`${t}_old`)
			.first();
		if (!hasOld) continue;
		await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
		await db.prepare(`ALTER TABLE ${t}_old RENAME TO ${t}`).run();
	}
}

/** D1 batch of five ALTER RENAME: probe at start-up; fallback is sequential. */
let renameBatchOk: boolean | null = null;

export function setRenameBatchOk(v: boolean | null): void {
	renameBatchOk = v;
}

async function renameToOld(db: Db): Promise<void> {
	const stmts = MIGRATE_TABLES.map((t) => db.prepare(`ALTER TABLE ${t} RENAME TO ${t}_old`));
	if (renameBatchOk !== false) {
		try {
			await db.batch(stmts);
			renameBatchOk = true;
			return;
		} catch {
			renameBatchOk = false;
		}
	}
	for (const t of MIGRATE_TABLES) {
		const already = await db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
			.bind(`${t}_old`)
			.first();
		if (already) continue;
		await db.prepare(`ALTER TABLE ${t} RENAME TO ${t}_old`).run();
	}
}

function cellSql(v: unknown): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return `'${escapeSql(v)}'`;
}

async function dumpTable(db: Db, table: string, columns: string[]): Promise<string> {
	const rows = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
	let out = '';
	for (const row of rows.results) {
		const vals = columns.map((c) => cellSql(row[c]));
		out += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')});\n`;
	}
	return out;
}

export function migrateExportHandler(env: AppEnv) {
	return async (c: Context): Promise<Response> => {
		if (!(await requireRoot(env, c))) return notFoundPage();
		let sql = '-- Infoto Export\n';
		sql += SCHEMA_SQL.trim() + '\n\n';
		sql += await dumpTable(env.db, 'users', ['id', 'uuid', 'created_at']);
		sql += '\n';
		sql += await dumpTable(env.db, 'photos', [
			'id',
			'sha256',
			'url',
			'uploader',
			'width',
			'height',
			'size',
			'created_at',
			'type',
			'likes',
			'dislikes',
			'reports',
		]);
		sql += '\n';
		sql += await dumpTable(env.db, 'announcements', ['id', 'title', 'content_md', 'sort', 'updated_at']);
		sql += '\n';
		sql += await dumpTable(env.db, 'reactions', ['ann_id', 'user_id', 'emoji']);
		sql += '\n';
		sql += await dumpTable(env.db, 'feedback', ['id', 'user_id', 'content_md', 'created_at']);
		const filename = `infoto-export-${Date.now()}.sql`;
		return new Response(sql, {
			headers: {
				'Content-Type': 'application/sql; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store',
			},
		});
	};
}

export function migrateImportHandler(env: AppEnv) {
	return async (c: Context): Promise<Response> => {
		if (!(await requireRoot(env, c))) return notFoundPage();
		let sqlText: string;
		try {
			const buf = await c.req.arrayBuffer();
			if (buf.byteLength > MAX_IMPORT_BYTES) return c.json({ error: 'payload too large' }, 413);
			sqlText = new TextDecoder().decode(buf);
		} catch {
			return c.json({ error: 'bad body' }, 400);
		}
		if (!sqlText.trim()) return c.json({ error: 'empty body' }, 400);

		const stmts = parseSqlStatements(sqlText);
		if (stmts.length === 0) return c.json({ error: 'no valid sql' }, 400);

		try {
			await renameToOld(env.db);
			await env.db.batch(CREATE_TABLE_SQL.map((s) => env.db.prepare(s.replace(/;$/, ''))));

			for (let i = 0; i < stmts.length; i += CHUNK) {
				const chunk = stmts.slice(i, i + CHUNK);
				try {
					await env.db.batch(chunk.map((s) => env.db.prepare(s.replace(/;$/, ''))));
				} catch (e) {
					let sFail = chunk[0]!;
					let detail = e instanceof Error ? e.message : String(e);
					for (const s of chunk) {
						try {
							await env.db.prepare(s.replace(/;$/, '')).run();
						} catch (inner) {
							sFail = s;
							detail = inner instanceof Error ? inner.message : String(inner);
							break;
						}
					}
					await restoreOldTables(env.db);
					return c.json({ error: 'import failed', detail, statement: sFail }, 500);
				}
			}

			for (const t of MIGRATE_TABLES) {
				await env.db.prepare(`DROP TABLE IF EXISTS ${t}_old`).run();
			}
			return c.json({ ok: true, imported: stmts.length });
		} catch (e) {
			await restoreOldTables(env.db);
			return c.json(
				{ error: 'import failed', detail: e instanceof Error ? e.message : String(e) },
				500,
			);
		}
	};
}
