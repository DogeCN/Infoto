// Request helpers shared by the /admin translate route: JSON body reading, the root
// identity gate and id validation.

import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from './db.ts';
import { ROOT_ID, resolveUser } from './identity.ts';

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
