// Request helpers shared by the /admin write routes: JSON body reading, the root
// identity gate, id validation and `sort` renumbering.

import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from './db.ts';
import { ROOT_ID, resolveUser } from './identity.ts';

/** Tables whose `sort` column holds a manual display order. */
export type SortTable = 'announcements' | 'feedback';

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

/** Distinct positive integer ids out of an `{ ids }` body; anything else is dropped. */
export function bodyIds(body: { ids?: unknown } | null): number[] {
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  return [
    ...new Set(
      raw.filter(
        (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
      ),
    ),
  ];
}

/** Place submitted IDs first, preserve the order of omitted rows, and assign consecutive sort values. */
export function reorderHandler(db: Db, table: SortTable) {
  return async (c: Context): Promise<Response> => {
    const ids = bodyIds(await readJson<{ ids?: unknown }>(c));
    if (ids.length === 0) return badRequest(c);
    const rows = await db
      .prepare(`SELECT id FROM ${table} ORDER BY sort ASC`)
      .all<{ id: number }>();
    const rank = new Map(ids.map((id, i) => [id, i]));
    const rest = ids.length;
    const all = rows.results
      .map((row) => row.id)
      .sort((a, b) => (rank.get(a) ?? rest) - (rank.get(b) ?? rest));
    await db.batch(
      all.map((id, i) => ({ sql: `UPDATE ${table} SET sort = ? WHERE id = ?`, binds: [i, id] })),
    );
    return c.json({ ok: true });
  };
}
