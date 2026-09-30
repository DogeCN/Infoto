// Worker entry: maps the D1 and ASSETS bindings onto the app environment and caches
// one Hono app per isolate.

import { createApp, type AppEnv } from './app.ts';
import { d1Db } from './db-d1.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA_HOST_URL?: string;
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
        mediaHostUrl: env.MEDIA_HOST_URL,
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
