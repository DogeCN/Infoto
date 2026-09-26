// POST /admin/feedback/reorder + DELETE /admin/feedback/:id — root-only feedback
// moderation. Creation rides /sync's fb_create and reads come from the /sync
// snapshot, so this sub-app is write-only.

import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { idParam, reorderHandler, rootGate } from './admin.ts';

export function feedbackApp(env: AppEnv): Hono {
  const app = new Hono();

  app.use('*', rootGate(env.db));

  app.post('/reorder', reorderHandler(env.db, 'feedback'));

  // Idempotent: deleting a row that is already gone is still a success.
  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ ok: false, error: 'bad_request' }, 400);
    await env.db.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  return app;
}
