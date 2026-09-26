// Shared plumbing for the /admin/* write sub-apps (announcements, feedback):
// root identity gate, JSON body reading, :id validation and sort renumbering.

import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from '../db.ts';
import { ROOT_ID, resolveUser } from '../identity.ts';

/** Tables whose `sort` column holds a manual display order. */
export type SortTable = 'announcements' | 'feedback';

/** JSON body of `c`, or null when it is missing or malformed. */
export function readJson<T>(c: Context): Promise<T | null> {
  return c.req.json<T>().catch(() => null);
}

/** Middleware rejecting every caller that is not the root identity. */
export function rootGate(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveUser(db, c.req.header('cookie'));
    if (!user || user.id !== ROOT_ID) return c.json({ ok: false, error: 'forbidden' }, 403);
    await next();
  };
}

/** Positive integer from the `:id` path parameter, or null. */
export function idParam(c: Context): number | null {
  const id = Number(c.req.param('id'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Positive finite ids out of an `{ ids }` body; anything else is dropped. */
export function bodyIds(body: { ids?: unknown } | null): number[] {
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  return raw.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
}

/** `POST /reorder` handler: renumber `sort` to 0…n-1 in the submitted order. */
export function reorderHandler(db: Db, table: SortTable) {
  return async (c: Context): Promise<Response> => {
    const ids = bodyIds(await readJson<{ ids?: unknown }>(c));
    if (ids.length === 0) return c.json({ ok: false, error: 'bad_request' }, 400);
    await db.batch(
      ids.map((id, i) => db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).bind(i, id)),
    );
    return c.json({ ok: true });
  };
}
