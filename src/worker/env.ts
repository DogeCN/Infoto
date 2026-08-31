// Runtime environment handed to the Hono app. Identical shape in both
// runtimes: Worker (D1 + ASSETS fetcher) and local Node (sqlite shim + dist fs).

import type { Db } from './db.ts';

export interface AppEnv {
	db: Db;
	/** Image-host signing secret (TC_SECRET). */
	tcSecret?: string;
	/** Cloudflare Turnstile secret key. */
	turnstileSecret?: string;
	/** Public Turnstile site key — delivered in the /sync 401 `turnstile_required` body. */
	turnstileSiteKey?: string;
	/** Worker: static fallback via the ASSETS binding. */
	assets?: (req: Request) => Promise<Response>;
	/** Local: resolve a pathname against dist/ (null = not found). */
	serveStatic?: (pathname: string) => Promise<Response | null>;
}
