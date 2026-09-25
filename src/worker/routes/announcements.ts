// POST|PUT|DELETE /admin/announcements + POST /admin/announcements/reorder.
// Root-only announcement write API — replaces the ann_* ops that used to ride
// /sync. Reads still come from the /sync snapshot, so this handler is write-only.

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.ts';
import type { Db } from '../db.ts';
import { ROOT_ID, resolveUser } from '../identity.ts';
import type { Announcement } from '../../shared/types.ts';

async function nextSort(db: Db): Promise<number> {
  const s = await db
    .prepare('SELECT COALESCE(MAX(sort) + 1, 0) AS s FROM announcements')
    .first<number>('s');
  return typeof s === 'number' ? s : 0;
}

async function insertAnnouncement(
  db: Db,
  title: string,
  contentMd: string,
  serverTime: number,
): Promise<{ id: number; sort: number }> {
  const sort = await nextSort(db);
  const result = await db
    .prepare('INSERT INTO announcements (title, content_md, sort, updated_at) VALUES (?, ?, ?, ?)')
    .bind(title, contentMd, sort, serverTime)
    .run();
  return { id: result.last_row_id, sort };
}

async function updateAnnouncement(
  db: Db,
  id: number,
  title: string,
  contentMd: string,
  serverTime: number,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE announcements SET title = ?, content_md = ?, updated_at = ? WHERE id = ?')
    .bind(title, contentMd, serverTime, id)
    .run();
  return result.changes > 0;
}

async function deleteAnnouncement(db: Db, id: number): Promise<void> {
  await db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM reactions WHERE ann_id = ?').bind(id).run();
  await db.prepare('DELETE FROM votes WHERE ann_id = ?').bind(id).run();
}

async function reorderAnnouncements(db: Db, ids: number[]): Promise<void> {
  await db.batch(
    ids.map((id, i) => db.prepare('UPDATE announcements SET sort = ? WHERE id = ?').bind(i, id)),
  );
}

function readJson<T>(c: Context): Promise<T | null> {
  return c.req.json<T>().catch(() => null);
}

export function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  // Root gate for every announcement write.
  app.use('*', async (c, next) => {
    const user = await resolveUser(env.db, c.req.header('cookie'));
    if (!user || user.id !== ROOT_ID) {
      return c.json({ ok: false, error: 'forbidden' }, 403);
    }
    await next();
  });

  app.post('/', async (c) => {
    const body = await readJson<{ title?: unknown; contentMd?: unknown }>(c);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    if (!title || !contentMd) return c.json({ ok: false, error: 'bad_request' }, 400);
    const serverTime = Date.now();
    const { id, sort } = await insertAnnouncement(env.db, title, contentMd, serverTime);
    const announcement: Announcement = {
      id,
      title,
      contentMd,
      sort,
      updatedAt: serverTime,
      reactions: [],
      votes: [],
    };
    return c.json({ ok: true, announcement });
  });

  // Reorder BEFORE :id so the literal path wins over the param.
  app.post('/reorder', async (c) => {
    const body = await readJson<{ ids?: unknown }>(c);
    const raw = Array.isArray(body?.ids) ? body!.ids : [];
    const ids = raw.filter(
      (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0,
    );
    if (ids.length === 0) return c.json({ ok: false, error: 'bad_request' }, 400);
    await reorderAnnouncements(env.db, ids);
    return c.json({ ok: true });
  });

  app.put('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'bad_request' }, 400);
    const body = await readJson<{ title?: unknown; contentMd?: unknown }>(c);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    if (!title || !contentMd) return c.json({ ok: false, error: 'bad_request' }, 400);
    const okUpdate = await updateAnnouncement(env.db, id, title, contentMd, Date.now());
    if (!okUpdate) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  app.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ ok: false, error: 'bad_request' }, 400);
    await deleteAnnouncement(env.db, id);
    return c.json({ ok: true });
  });

  return app;
}
