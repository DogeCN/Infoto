// Runtime environment handed to the Hono app: Worker (D1 + ASSETS fetcher).
// Unit tests use the node:sqlite shim (src/local/d1-shim.ts) as the Db.

import type { Db } from './db.ts';

export interface AppEnv {
  db: Db;
  /** Image-host signing secret (TC_SECRET). */
  tcSecret?: string;
  /** Cloudflare Turnstile secret key. */
  turnstileSecret?: string;
  /** Public Turnstile site key — delivered in the /sync 401 `turnstile_required` body. */
  turnstileSiteKey?: string;
  /** Static fallback via the ASSETS binding. */
  assets?: (req: Request) => Promise<Response>;
}
