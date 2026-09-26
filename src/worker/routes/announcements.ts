// POST|PUT|DELETE /admin/announcements + POST /admin/announcements/reorder.
// Root-only write API; reads come from the /sync snapshot.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.ts';
import type { Announcement } from '../../shared/types.ts';
import { idParam, readJson, reorderHandler, rootGate } from './admin.ts';

async function nextSort(app: AppEnv): Promise<number> {
  const s = await app.db
    .prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS s FROM announcements')
    .first<number>('s');
  return typeof s === 'number' ? s : 0;
}

async function insertAnnouncement(
  app: AppEnv,
  title: string,
  contentMd: string,
  serverTime: number,
): Promise<{ id: number; sort: number }> {
  const sort = await nextSort(app);
  const result = await app.db
    .prepare('INSERT INTO announcements (title, content_md, sort, updated_at) VALUES (?, ?, ?, ?)')
    .bind(title, contentMd, sort, serverTime)
    .run();
  return { id: result.last_row_id, sort };
}

async function updateAnnouncement(
  app: AppEnv,
  id: number,
  title: string,
  contentMd: string,
  serverTime: number,
): Promise<boolean> {
  const result = await app.db
    .prepare('UPDATE announcements SET title = ?, content_md = ?, updated_at = ? WHERE id = ?')
    .bind(title, contentMd, serverTime, id)
    .run();
  return result.changes > 0;
}

async function deleteAnnouncement(app: AppEnv, id: number): Promise<void> {
  await app.db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  await app.db.prepare('DELETE FROM reactions WHERE ann_id = ?').bind(id).run();
  await app.db.prepare('DELETE FROM votes WHERE ann_id = ?').bind(id).run();
}

function readDraft(c: Context): Promise<{ title: string; contentMd: string } | null> {
  return readJson<{ title?: unknown; contentMd?: unknown }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    return title && contentMd ? { title, contentMd } : null;
  });
}

const badRequest = (c: Context): Response => c.json({ ok: false, error: 'bad_request' }, 400);

export function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.use('*', rootGate(env.db));

  app.post('/', async (c) => {
    const draft = await readDraft(c);
    if (!draft) return badRequest(c);
    const serverTime = Date.now();
    const { id, sort } = await insertAnnouncement(env, draft.title, draft.contentMd, serverTime);
    const announcement: Announcement = {
      id,
      title: draft.title,
      contentMd: draft.contentMd,
      sort,
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
    const okUpdate = await updateAnnouncement(env, id, draft.title, draft.contentMd, Date.now());
    if (!okUpdate) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // Idempotent: deleting a row that is already gone is still a success.
  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await deleteAnnouncement(env, id);
    return c.json({ ok: true });
  });

  return app;
}
