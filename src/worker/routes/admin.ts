// Root-only admin write APIs. Snapshot reads come from /sync and are scoped to the active locale.

import { Hono, type Context } from 'hono';
import type { Announcement, LocaleCode, Poll } from '../../shared/types.ts';
import { isLocaleCode } from '../../shared/copy.ts';
import type { AppEnv } from '../app.ts';
import { badRequest, idParam, readJson, reorderHandler, rootGate } from '../http.ts';

/** Trimmed announcement title/body and explicit language, or null when invalid. */
function readAnnouncementDraft(
  c: Context,
): Promise<{ title: string; contentMd: string; locale: LocaleCode } | null> {
  return readJson<{ title?: unknown; contentMd?: unknown; locale?: unknown }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    const raw = body?.locale;
    const locale = isLocaleCode(raw) ? raw : null;
    return title && contentMd && locale ? { title, contentMd, locale } : null;
  });
}

function readPollDraft(c: Context): Promise<{
  title: string;
  options: string[];
  allowMultiple: boolean;
  locale: LocaleCode;
} | null> {
  return readJson<{
    title?: unknown;
    options?: unknown;
    allowMultiple?: unknown;
    locale?: unknown;
  }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const options = Array.isArray(body?.options)
      ? body.options
          .filter((option): option is string => typeof option === 'string')
          .map((option) => option.trim())
      : [];
    const raw = body?.locale;
    const locale = isLocaleCode(raw) ? raw : null;
    if (
      !title ||
      title.length > 200 ||
      options.length < 2 ||
      options.length > 100 ||
      options.some((option) => option.length === 0 || option.length > 200) ||
      typeof body?.allowMultiple !== 'boolean' ||
      !locale
    )
      return null;
    return { title, options, allowMultiple: body.allowMultiple, locale };
  });
}

function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readAnnouncementDraft(c);
    if (!draft) return badRequest(c);
    const serverTime = Date.now();
    // `sort` is assigned inside the INSERT, so concurrent creates in one locale cannot collide.
    const { last_row_id: id } = await env.db
      .prepare(
        `INSERT INTO announcements (title, content_md, locale, sort, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM announcements WHERE locale = ?), ?)`,
      )
      .bind(draft.title, draft.contentMd, draft.locale, draft.locale, serverTime)
      .run();
    const row = await env.db
      .prepare('SELECT sort FROM announcements WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const announcement: Announcement = {
      id,
      title: draft.title,
      contentMd: draft.contentMd,
      locale: draft.locale,
      sort: typeof row === 'number' ? row : 0,
      updatedAt: serverTime,
      reactions: [],
    };
    return c.json({ ok: true, announcement });
  });

  app.post('/reorder', reorderHandler(env.db, 'announcements'));

  app.put('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    const draft = await readAnnouncementDraft(c);
    if (!draft) return badRequest(c);
    const result = await env.db
      .prepare(
        'UPDATE announcements SET title = ?, content_md = ?, locale = ?, updated_at = ? WHERE id = ?',
      )
      .bind(draft.title, draft.contentMd, draft.locale, Date.now(), id)
      .run();
    if (result.changes === 0) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  // Deleting an announcement also removes its reactions; polls are independently managed.
  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await env.db.batch([
      { sql: 'DELETE FROM announcements WHERE id = ?', binds: [id] },
      { sql: 'DELETE FROM reactions WHERE ann_id = ?', binds: [id] },
    ]);
    return c.json({ ok: true });
  });

  return app;
}

function pollsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readPollDraft(c);
    if (!draft) return badRequest(c);
    const { last_row_id: id } = await env.db
      .prepare(
        `INSERT INTO polls (title, options, allow_multiple, locale, sort)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM polls WHERE locale = ?))`,
      )
      .bind(
        draft.title,
        JSON.stringify(draft.options),
        draft.allowMultiple ? 1 : 0,
        draft.locale,
        draft.locale,
      )
      .run();
    const row = await env.db
      .prepare('SELECT sort FROM polls WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const poll: Poll = {
      id,
      title: draft.title,
      options: draft.options,
      allowMultiple: draft.allowMultiple,
      locale: draft.locale,
      sort: typeof row === 'number' ? row : 0,
      votes: [],
    };
    return c.json({ ok: true, poll });
  });

  app.post('/reorder', reorderHandler(env.db, 'polls'));

  app.put('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    const draft = await readPollDraft(c);
    if (!draft) return badRequest(c);
    const existing = await env.db
      .prepare('SELECT options, allow_multiple, locale FROM polls WHERE id = ?')
      .bind(id)
      .first<{ options: string; allow_multiple: number; locale: LocaleCode }>();
    if (!existing) return c.json({ ok: false, error: 'not_found' }, 404);

    let previousOptions: unknown;
    try {
      previousOptions = JSON.parse(existing.options);
    } catch {
      previousOptions = null;
    }
    const optionsChanged =
      !Array.isArray(previousOptions) ||
      previousOptions.length !== draft.options.length ||
      previousOptions.some((option, index) => option !== draft.options[index]);
    const definitionChanged =
      optionsChanged ||
      existing.allow_multiple !== Number(draft.allowMultiple) ||
      existing.locale !== draft.locale;
    const statements = [
      {
        sql: 'UPDATE polls SET title = ?, options = ?, allow_multiple = ?, locale = ? WHERE id = ?',
        binds: [
          draft.title,
          JSON.stringify(draft.options),
          draft.allowMultiple ? 1 : 0,
          draft.locale,
          id,
        ],
      },
    ];
    if (definitionChanged)
      statements.push({ sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [id] });
    const [result] = await env.db.batch(statements);
    if (!result || result.changes === 0) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await env.db.batch([
      { sql: 'DELETE FROM polls WHERE id = ?', binds: [id] },
      { sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [id] },
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
  app.route('/polls', pollsApp(env));
  app.route('/feedback', feedbackApp(env));
  return app;
}
