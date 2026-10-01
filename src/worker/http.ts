// Request helpers shared by the /admin write routes: JSON body reading, the root
// identity gate, id validation and `sort` renumbering.

import type { Context, MiddlewareHandler } from 'hono';
import type { LocaleCode } from '../shared/copy.ts';
import { locales } from '../shared/copy.ts';
import type { Db } from './db.ts';
import { ROOT_ID, resolveUser } from './identity.ts';

/** Tables whose `sort` column holds a manual display order. */
export type SortTable = 'announcements' | 'feedback' | 'polls';

function localeCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && Object.hasOwn(locales, value);
}

/** JSON body of `c`, or null when it is missing or malformed. */
export function readJson<T>(c: Context): Promise<T | null> {
  return c.req.json<T>().catch(() => null);
}

export function badRequest(c: Context): Response {
  return c.json({ ok: false, error: 'bad_request' }, 400);
}

export function forbidden(c: Context): Response {
  return c.json({ ok: false, error: 'forbidden' }, 403);
}

/** Middleware rejecting every caller that is not the root identity. */
export function rootGate(db: Db): MiddlewareHandler {
  return async (c, next) => {
    if (!(await requireRoot(db, c))) return forbidden(c);
    await next();
  };
}

/** Check whether the request belongs to the root identity. */
export async function requireRoot(db: Db, c: Context): Promise<boolean> {
  const user = await resolveUser(db, c.req.header('cookie'));
  return user !== null && user.id === ROOT_ID;
}

/** Positive integer from the `:id` path parameter, or null. Only plain decimal
 * digits count: `Number()` would also accept `0x10`, `1e3` and `' 1 '`. */
export function idParam(c: Context): number | null {
  const raw = c.req.param('id') ?? '';
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Non-negative integer path parameter for zero-based poll IDs. */
export function nonNegativeIdParam(c: Context): number | null {
  const raw = c.req.param('id') ?? '';
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Distinct integer ids out of an `{ ids }` body; poll IDs may include zero. */
export function bodyIds(body: { ids?: unknown } | null, allowZero = false): number[] {
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  return [
    ...new Set(
      raw.filter(
        (id): id is number =>
          typeof id === 'number' && Number.isSafeInteger(id) && (allowZero ? id >= 0 : id > 0),
      ),
    ),
  ];
}

/** Place submitted locale IDs first, preserve omitted rows, and renumber the locale's list. */
export function reorderHandler(db: Db, table: SortTable, allowZero = false) {
  return async (c: Context): Promise<Response> => {
    const body = await readJson<{ ids?: unknown; locale?: unknown }>(c);
    if (!localeCode(body?.locale)) return badRequest(c);
    const locale = body.locale;
    const ids = bodyIds(body, allowZero);
    if (ids.length === 0) return badRequest(c);
    const rows = await db
      .prepare(`SELECT id FROM ${table} WHERE locale = ? ORDER BY sort ASC, id ASC`)
      .bind(locale)
      .all<{ id: number }>();
    const rank = new Map(ids.map((id, i) => [id, i]));
    const rest = ids.length;
    const all = rows.results
      .map((row) => row.id)
      .sort((a, b) => (rank.get(a) ?? rest) - (rank.get(b) ?? rest));
    await db.batch(
      all.map((id, i) => ({
        sql: `UPDATE ${table} SET sort = ? WHERE id = ? AND locale = ?`,
        binds: [i, id, locale],
      })),
    );
    return c.json({ ok: true });
  };
}
