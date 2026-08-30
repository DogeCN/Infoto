// Identity & Cookie (spec: "身份与 Cookie").
// Cookie carries the uuid only; numeric short ids are public, uuids never are.
// ID=0 (the very first visitor) is the root user with all admin powers.

import type { Db } from './db.ts';

export const COOKIE_NAME = 'infoto_id';
/** ~10 years — effectively permanent, refreshed (sliding) on every /sync. */
export const COOKIE_MAX_AGE = 315360000;
export const ROOT_ID = 0;

export interface UserRow {
	id: number;
	uuid: string;
	created_at: number;
}

export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq <= 0) continue;
		const k = part.slice(0, eq).trim();
		const v = part.slice(eq + 1).trim();
		if (k) out[k] = decodeURIComponent(v);
	}
	return out;
}

/** HttpOnly, SameSite=Lax, long Max-Age; Secure only on https or non-localhost. */
export function sessionCookie(uuid: string, request: Request): string {
	const url = new URL(request.url);
	const host = url.hostname;
	const isHttps = url.protocol === 'https:';
	const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
	const parts = [
		`${COOKIE_NAME}=${encodeURIComponent(uuid)}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
		`Max-Age=${COOKIE_MAX_AGE}`,
	];
	if (isHttps || !isLocalhost) parts.splice(3, 0, 'Secure');
	return parts.join('; ');
}

export async function findUserByUuid(db: Db, uuid: string | undefined): Promise<UserRow | null> {
	if (!uuid) return null;
	return db.prepare('SELECT id, uuid, created_at FROM users WHERE uuid = ?').bind(uuid).first<UserRow>();
}

/** Resolve identity from Cookie `infoto_id` only. */
export async function resolveUser(db: Db, cookieHeader: string | undefined): Promise<UserRow | null> {
	const fromCookie = parseCookies(cookieHeader)[COOKIE_NAME];
	return findUserByUuid(db, fromCookie);
}

/** Create a new identity: id = COALESCE(MAX(id), -1) + 1 (first visitor gets 0). */
export async function createUser(db: Db): Promise<UserRow> {
	const next = await db.prepare('SELECT COALESCE(MAX(id), -1) + 1 AS id FROM users').first<{ id: number }>('id');
	const id = typeof next === 'number' ? next : 0;
	const uuid = crypto.randomUUID();
	const created_at = Date.now();
	await db.prepare('INSERT INTO users (id, uuid, created_at) VALUES (?, ?, ?)').bind(id, uuid, created_at).run();
	return { id, uuid, created_at };
}
