// Root-only admin APIs that remain on HTTP: draft translation.
// Announcement / poll / feedback mutations move to WebSocket ops via Durable Object.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { badRequest, readJson, rootGate } from '../http.ts';
import { isOversizedTranslation, readTranslationRequest } from '../translate.ts';

/** Draft translation for the admin cards. Stateless: the request carries the content. */
function translateHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    const request = readTranslationRequest(await readJson(c));
    if (!request) return badRequest(c);
    if (isOversizedTranslation(request)) return c.json({ ok: false, error: 'too_large' }, 413);
    if (!env.translate) return c.json({ ok: false, error: 'translation_unavailable' }, 503);
    try {
      const draft = await env.translate(request);
      return c.json({ ok: true, ...draft });
    } catch (error) {
      console.error('[translate]', error);
      return c.json({ ok: false, error: 'translation_failed' }, 502);
    }
  };
}

export function adminApp(env: AppEnv): Hono {
  const app = new Hono();
  app.use('*', rootGate(env.db));
  app.post('/translate', translateHandler(env));
  return app;
}
