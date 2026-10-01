// Root-only SQL export and import. Import replaces the dataset and restores backup tables on failure.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import type { Db } from '../db.ts';
import { badRequest, forbidden, requireRoot } from '../http.ts';
import { CREATE_TABLE_SQL, SCHEMA_SQL } from '../schema-ddl.ts';

/** Every table, with the columns the export writes, in dump order. */
export const EXPORT_COLUMNS = {
  users: ['id', 'uuid', 'created_at'],
  photos: [
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
  ],
  announcements: ['id', 'locale', 'title', 'content_md', 'sort', 'updated_at'],
  reactions: ['ann_id', 'user_id', 'emoji'],
  polls: ['id', 'locale', 'title', 'options', 'allow_multiple', 'sort', 'created_at', 'updated_at'],
  votes: ['poll_id', 'user_id', 'option'],
  feedback: ['id', 'user_id', 'locale', 'content_md', 'created_at', 'sort'],
} as const;

export const MIGRATE_TABLES = Object.keys(EXPORT_COLUMNS);

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** Statements per transaction. */
const CHUNK = 100;

/** SQLite string literals have no backslash escapes: doubling single quotes is the
 *  only way to embed one. */
function escapeSql(value: unknown): string {
  return String(value ?? '').replace(/'/g, "''");
}

/** Split a SQL script into statements, then keep only the INSERTs. Quote- and
 *  comment-aware, so a semicolon, a line comment or a block comment inside a string
 *  literal is not treated as a separator. */
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
          cur += "'";
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
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += ' ';
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 1;
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

const hasTable = async (db: Db, name: string): Promise<boolean> =>
  (await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(name)
    .first()) !== null;

/** Swap every `_old` copy back over its table, so a failed import leaves the data intact. */
export async function restoreOldTables(db: Db): Promise<void> {
  for (const t of MIGRATE_TABLES) {
    if (!(await hasTable(db, `${t}_old`))) continue;
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
    await db.prepare(`ALTER TABLE ${t}_old RENAME TO ${t}`).run();
  }
}

async function renameToOld(db: Db): Promise<void> {
  for (const t of MIGRATE_TABLES) {
    if (await hasTable(db, `${t}_old`)) continue;
    await db.prepare(`ALTER TABLE ${t} RENAME TO ${t}_old`).run();
  }
}

function cellSql(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${escapeSql(value)}'`;
}

async function dumpTable(db: Db, table: string, columns: readonly string[]): Promise<string> {
  const rows = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
  const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES `;
  let out = '';
  for (const row of rows.results) {
    out += `${head}(${columns.map((c) => cellSql(row[c])).join(', ')});\n`;
  }
  return out;
}

const strip = (sql: string): string => sql.replace(/;$/, '');

export function migrateExportHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    if (!(await requireRoot(env.db, c))) return forbidden(c);
    const parts = ['-- Infoto Export\n', SCHEMA_SQL.trim(), ''];
    for (const [table, columns] of Object.entries(EXPORT_COLUMNS)) {
      parts.push('\n', await dumpTable(env.db, table, columns));
    }
    return new Response(parts.join('\n'), {
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="infoto-export-${Date.now()}.sql"`,
        'Cache-Control': 'no-store',
      },
    });
  };
}

export function migrateImportHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    if (!(await requireRoot(env.db, c))) return forbidden(c);

    const declared = Number(c.req.header('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) {
      return c.json({ ok: false, error: 'payload_too_large' }, 413);
    }
    let sqlText: string;
    try {
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength > MAX_IMPORT_BYTES) {
        return c.json({ ok: false, error: 'payload_too_large' }, 413);
      }
      sqlText = new TextDecoder().decode(buf);
    } catch {
      return badRequest(c);
    }
    if (!sqlText.trim()) return badRequest(c);

    const stmts = parseSqlStatements(sqlText);
    if (stmts.length === 0) {
      return c.json({ ok: false, error: 'no_valid_sql' }, 400);
    }

    try {
      await renameToOld(env.db);
      await env.db.batch(CREATE_TABLE_SQL.map((s) => ({ sql: strip(s), binds: [] })));

      for (let i = 0; i < stmts.length; i += CHUNK) {
        const chunk = stmts.slice(i, i + CHUNK);
        try {
          await env.db.batch(chunk.map((s) => ({ sql: strip(s), binds: [] })));
        } catch (e) {
          // Replay the chunk one statement at a time to name the exact failing INSERT.
          let statement = chunk[0]!;
          let detail = e instanceof Error ? e.message : String(e);
          for (const s of chunk) {
            try {
              await env.db.prepare(strip(s)).run();
            } catch (inner) {
              statement = s;
              detail = inner instanceof Error ? inner.message : String(inner);
              break;
            }
          }
          await restoreOldTables(env.db);
          return c.json({ ok: false, error: 'import_failed', detail, statement }, 422);
        }
      }

      for (const t of MIGRATE_TABLES) {
        await env.db.prepare(`DROP TABLE IF EXISTS ${t}_old`).run();
      }
      return c.json({ ok: true, imported: stmts.length });
    } catch (e) {
      await restoreOldTables(env.db);
      return c.json(
        {
          ok: false,
          error: 'import_failed',
          detail: e instanceof Error ? e.message : String(e),
        },
        500,
      );
    }
  };
}
