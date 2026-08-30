// `npm run start` — local Node runtime (no Cloudflare account needed).
// Reads .env, opens .data/infoto.db (node:sqlite), applies schema.sql,
// mounts the very same Hono app as the Worker, serves dist/ statically.

import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { createApp } from '../worker/app.ts';
import type { AppEnv } from '../worker/env.ts';
import { openLocalDb } from './d1-shim.ts';

const root = path.resolve(import.meta.dirname, '..', '..');

function loadEnv(file: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(file)) return out;
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

const dotenv = { ...loadEnv(path.join(root, '.env')), ...process.env };

const dataDir = path.join(root, '.data');
mkdirSync(dataDir, { recursive: true });
const db = openLocalDb(path.join(dataDir, 'infoto.db'));
db.exec(readFileSync(path.join(root, 'schema.sql'), 'utf8'));

const distDir = path.join(root, 'dist');
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.webm': 'video/webm',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
	'.map': 'application/json',
};

async function serveStatic(pathname: string): Promise<Response | null> {
	let rel: string;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
	const file = path.normalize(path.join(distDir, rel));
	if (file !== distDir && !file.startsWith(distDir + path.sep)) return null;
	try {
		const data = await readFile(file);
		return new Response(new Blob([data]), {
			headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
		});
	} catch {
		if (!/\.[a-z0-9]+$/i.test(rel)) {
			try {
				const shell = await readFile(path.join(distDir, 'index.html'));
				return new Response(new Blob([shell]), { headers: { 'Content-Type': MIME['.html'] } });
			} catch {
				return null;
			}
		}
		return null;
	}
}

const appEnv: AppEnv = {
	db,
	tcSecret: dotenv.TC_SECRET,
	turnstileSecret: dotenv.TURNSTILE_SECRET_KEY,
	turnstileSiteKey: dotenv.TURNSTILE_SITE_KEY,
	serveStatic,
};

const app = createApp(appEnv);
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`Infoto local runtime: http://localhost:${info.port}`);
});
