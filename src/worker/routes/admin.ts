// Root-only admin write APIs: /admin/announcements (create / update / delete / reorder)
// and /admin/feedback (delete / reorder). Reads come from the /sync snapshot, so every
// route here is write-only.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app.ts';
import type { Announcement } from '../../shared/types.ts';
import { badRequest, idParam, readJson, reorderHandler, rootGate } from '../http.ts';

/** Trimmed title plus body of an announcement draft, or null when either is missing. */
function readDraft(c: Context): Promise<{ title: string; contentMd: string } | null> {
  return readJson<{ title?: unknown; contentMd?: unknown }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    return title && contentMd ? { title, contentMd } : null;
  });
}

function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readDraft(c);
    if (!draft) return badRequest(c);
    const serverTime = Date.now();
    // `sort` is assigned inside the INSERT, so two concurrent creates cannot collide.
    const { last_row_id: id } = await env.db
      .prepare(
        `INSERT INTO announcements (title, content_md, sort, updated_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM announcements), ?)`,
      )
      .bind(draft.title, draft.contentMd, serverTime)
      .run();
    const row = await env.db
      .prepare('SELECT sort FROM announcements WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const announcement: Announcement = {
      id,
      title: draft.title,
      contentMd: draft.contentMd,
      sort: typeof row === 'number' ? row : 0,
      updatedAt: serverTime,
      reactions: [],
      votes: [],
    };
    return c.json({ ok: true, announcement });
  });

  app.post('/reorder', reorderHandler(env.db, 'announcements'));

  app.put('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    const draft = await readDraft(c);
    if (!draft) return badRequest(c);
    const result = await env.db
      .prepare('UPDATE announcements SET title = ?, content_md = ?, updated_at = ? WHERE id = ?')
      .bind(draft.title, draft.contentMd, Date.now(), id)
      .run();
    if (result.changes === 0) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // Deleting a row that is already gone is still a success.
  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await env.db.batch([
      { sql: 'DELETE FROM announcements WHERE id = ?', binds: [id] },
      { sql: 'DELETE FROM reactions WHERE ann_id = ?', binds: [id] },
      { sql: 'DELETE FROM votes WHERE ann_id = ?', binds: [id] },
    ]);
    return c.json({ ok: true });
  });

  return app;
}

function feedbackApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/reorder', reorderHandler(env.db, 'feedback'));

  // Deleting a row that is already gone is still a success.
  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await env.db.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  return app;
}

export function adminApp(env: AppEnv): Hono {
  const app = new Hono();
  app.use('*', rootGate(env.db));
  app.route('/announcements', announcementsApp(env));
  app.route('/feedback', feedbackApp(env));
  return app;
}
