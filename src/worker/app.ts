// Hono app assembly and the runtime environment it is handed.

import { Hono } from 'hono';
import type { Db } from './db.ts';
import { notFoundPage, serverErrorPage } from './errors.ts';
import { syncHandler } from './routes/sync.ts';
import { mediaHandler } from './routes/media.ts';
import { migrateExportHandler, migrateImportHandler } from './routes/migrate.ts';
import { adminApp } from './routes/admin.ts';

export interface AppEnv {
  db: Db;
  /** Standalone image-host facade the browser uploads to (see media-proxy/worker.js).
   *  Delivered in the /sync response; defaults to the local simulated host in dev. */
  mediaHostUrl?: string;
  /** Cloudflare Turnstile secret key. */
  turnstileSecret?: string;
  /** Public Turnstile site key — delivered in the /sync 401 `turnstile_required` body. */
  turnstileSiteKey?: string;
  /** Static file fallback (the ASSETS binding). */
  assets?: (req: Request) => Promise<Response>;
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
  app.get('/l/:id36', mediaHandler(env));
  app.get('/admin/migrate', migrateExportHandler(env));
  app.post('/admin/migrate', migrateImportHandler(env));
  app.route('/admin', adminApp(env));
  // /admin (the management page) is a front-end route: the SPA fallback serves it.
  app.all('/admin/*', (c) => notFoundPage(c.req.raw));
  app.get('*', async (c) => {
    // The SPA shell exists for exactly two client routes. Everything else is a hard 404:
    // answering arbitrary paths with index.html made crawlers (and Google's URL fetcher)
    // read missing pages as existing ones. Trailing slashes normalize to the same routes.
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
