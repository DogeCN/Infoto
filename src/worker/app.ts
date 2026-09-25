// Hono app assembly — one app serves both runtimes.
// Route order is fixed by spec: /sync -> /upload -> /l/:id36 -> /admin* -> /* static.

import { Hono } from 'hono';
import type { AppEnv } from './env.ts';
import { notFoundPage, serverErrorPage } from './errors.ts';
import { syncHandler } from './routes/sync.ts';
import { uploadHandler } from './routes/upload.ts';
import { mediaHandler } from './routes/media.ts';
import { migrateExportHandler, migrateImportHandler } from './routes/migrate.ts';
import { announcementsApp } from './routes/announcements.ts';

export function createApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/sync', syncHandler(env));
  app.post('/upload', uploadHandler(env));
  app.get('/l/:id36', mediaHandler(env));
  app.get('/admin/migrate', migrateExportHandler(env));
  app.post('/admin/migrate', migrateImportHandler(env));
  app.route('/admin/announcements', announcementsApp(env));
  // /admin (management page) is NOT a Worker route: it falls through to the ASSETS SPA
  // fallback (wrangler not_found_handling) and serves index.html. Root-user boundary is
  // frontend-only; every privileged op stays server-gated (/sync root, /admin/migrate).
  app.all('/admin/*', () => notFoundPage());
  app.get('*', async (c) => {
    if (env.assets) {
      const res = await env.assets(c.req.raw);
      if (res.status !== 404) return res;
      return notFoundPage();
    }
    return notFoundPage();
  });

  app.notFound(() => notFoundPage());
  app.onError((err, c) => {
    console.error('[infoto]', err);
    // JSON endpoints must fail as JSON (contract: clients parse bodies) —
    // the custom 5xx page is for page-class routes only
    const p = new URL(c.req.url).pathname;
    if (p === '/sync' || p === '/upload') return c.json({ ok: false, error: 'internal' }, 500);
    return serverErrorPage();
  });

  return app;
}
