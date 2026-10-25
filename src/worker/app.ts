// Hono app assembly and the runtime environment it is handed.

import { Hono } from 'hono';
import type { Translator } from '../shared/types.ts';
import type { Db } from './db.ts';
import { notFoundPage, serverErrorPage } from './errors.ts';
import { syncHandler } from './routes/sync.ts';
import { mediaHandler } from './routes/media.ts';
import { migrateExportHandler, migrateImportHandler } from './routes/migrate.ts';
import { adminApp } from './routes/admin.ts';

export interface AppEnv {
  db: Db;
  /** External image-host facade the browser uploads to (contract: README §Media host facade).
   *  Delivered in the /sync response; defaults to the local simulated host in dev. */
  mediaHostUrl?: string;
  /** Cloudflare Turnstile secret key. */
  turnstileSecret?: string;
  /** Public Turnstile site key — delivered in the /sync 401 `turnstile_required` body. */
  turnstileSiteKey?: string;
  /** Static file fallback (the ASSETS binding). */
  assets?: (req: Request) => Promise<Response>;
  /** Admin translation drafts. Absent when neither the AI binding nor the dev REST runner exists. */
  translate?: Translator;
}

/** Endpoints answering JSON. Everything else gets the HTML error page, so a media
 *  proxy or static request never has to parse an error body. */
const JSON_ROUTE = /^\/(?:sync|admin)(?:\/|$)/;

export function createApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/sync', syncHandler(env));
  // A real robots policy: the SPA fallback would otherwise answer /robots.txt with the
  // HTML shell (a soft-200 that crawlers — e.g. the Google Lens URL fetcher — read as
  // noise instead of a policy).
  app.get('/robots.txt', () => {
    const body = 'User-agent: *\nDisallow: /admin\nDisallow: /sync\n';
    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });
  // A shared link is often pasted with a trailing slash (`/l/19/`). The SPA fallback already
  // normalizes trailing slashes for its own routes, so the media route accepts one too instead
  // of answering a hard 404 for a link that names an existing photo. Both forms share one
  // handler instance; a second slash is not produced by any path the app hands out.
  const media = mediaHandler(env);
  app.get('/l/:id36', media);
  app.get('/l/:id36/', media);
  app.get('/admin/migrate', migrateExportHandler(env));
  app.post('/admin/migrate', migrateImportHandler(env));
  app.route('/admin', adminApp(env));
  app.get('*', async (c) => {
    // This handler runs only for a request that reached the Worker: `run_worker_first` names
    // the paths a deployment hands over, and `wrangler dev` hands over everything. It serves
    // the SPA shell for the two client routes and answers every other path with a hard 404 —
    // an unmatched `/admin/*` included, so no API-shaped path can fall through to the shell.
    // Trailing slashes normalize to the same routes.
    const path = new URL(c.req.raw.url).pathname.replace(/\/+$/, '') || '/';
    if ((path === '/' || path === '/admin') && env.assets) {
      const res = await env.assets(c.req.raw);
      if (res.status !== 404) return res;
    }
    return notFoundPage(c.req.raw);
  });

  app.notFound((c) => notFoundPage(c.req.raw));
  app.onError((err, c) => {
    console.error('[infoto]', err);
    if (JSON_ROUTE.test(new URL(c.req.url).pathname)) {
      return c.json({ ok: false, error: 'internal' }, 500);
    }
    return serverErrorPage(c.req.raw);
  });

  return app;
}
