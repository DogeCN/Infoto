// Infoto Worker entry — phase 1 backend.
// Route order: /sync -> /upload -> /l/:id36 -> /admin* -> ASSETS static fallback.

import { createApp } from './app.ts';
import { d1Db } from './db-d1.ts';
import type { AppEnv } from './env.ts';

export interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	TC_SECRET?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITE_KEY?: string;
}

const apps = new WeakMap<Env, ReturnType<typeof createApp>>();

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		let app = apps.get(env);
		if (!app) {
			const appEnv: AppEnv = {
				db: d1Db(env.DB),
				tcSecret: env.TC_SECRET,
				turnstileSecret: env.TURNSTILE_SECRET_KEY,
				turnstileSiteKey: env.TURNSTILE_SITE_KEY,
				assets: (req) => env.ASSETS.fetch(req),
			};
			app = createApp(appEnv);
			apps.set(env, app);
		}
		return app.fetch(request);
	},
};
