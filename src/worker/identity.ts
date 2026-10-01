// Identity and session cookie. The cookie carries the uuid only; numeric short ids are
// public, uuids never are. Id 0 — the first visitor — is the root identity.

import type { Db } from './db.ts';

const COOKIE_NAME = 'uuid';
/** Cookie lifetime in seconds. The cookie is re-issued on every /sync, so this is a
 *  sliding window; 400 days is the largest value browsers accept. */
const COOKIE_MAX_AGE = 345_600_000;
export const ROOT_ID = 0;

export interface UserRow {
  id: number;
  uuid: string;
  created_at: number;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // A malformed escape is not an identity — skip the pair.
    }
  }
  return out;
}

/** HttpOnly, SameSite=Lax, long Max-Age. `Secure` is added only over https: a browser
 *  drops a Secure cookie sent over plain http, which would log out every visitor on an
 *  http:// LAN address. */
export function sessionCookie(uuid: string, request: Request): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(uuid)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (new URL(request.url).protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

async function findUserByUuid(db: Db, uuid: string | undefined): Promise<UserRow | null> {
  if (!uuid) return null;
  return db
    .prepare('SELECT id, uuid, created_at FROM users WHERE uuid = ?')
    .bind(uuid)
    .first<UserRow>();
}

/** Identity for the request's `uuid` cookie, or null. */
export async function resolveUser(
  db: Db,
  cookieHeader: string | undefined,
): Promise<UserRow | null> {
  return findUserByUuid(db, parseCookies(cookieHeader)[COOKIE_NAME]);
}

/** Insert a user with the next integer ID and retrieve the row by UUID. */
export async function createUser(db: Db): Promise<UserRow> {
  const uuid = crypto.randomUUID();
  const created_at = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, uuid, created_at)
       VALUES ((SELECT COALESCE(MAX(id), -1) + 1 FROM users), ?, ?)`,
    )
    .bind(uuid, created_at)
    .run();
  const id = await db.prepare('SELECT id FROM users WHERE uuid = ?').bind(uuid).first<number>('id');
  if (typeof id !== 'number') throw new Error('inserted user could not be read back');
  return { id, uuid, created_at };
}
