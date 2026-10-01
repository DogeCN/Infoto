// Root-only admin write APIs. Reads come from the /sync snapshot, so every
// route here is write-only.

import { Hono, type Context } from 'hono';
import { locales, type LocaleCode } from '../../shared/copy.ts';
import type { Announcement, Poll } from '../../shared/types.ts';
import {
  badRequest,
  idParam,
  readJson,
  reorderHandler,
  rootGate,
  nonNegativeIdParam,
} from '../http.ts';
import type { AppEnv } from '../app.ts';

const MAX_POLL_OPTIONS = 100;
const MAX_POLL_OPTION_LENGTH = 500;

function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && Object.hasOwn(locales, value);
}

/** Trimmed title plus body of an announcement draft, or null when either is missing. */
function readAnnouncementDraft(
  c: Context,
): Promise<{ title: string; contentMd: string; locale: LocaleCode } | null> {
  return readJson<{ title?: unknown; contentMd?: unknown; locale?: unknown }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const contentMd = typeof body?.contentMd === 'string' ? body.contentMd : '';
    const locale = body?.locale;
    return title && contentMd && isLocaleCode(locale) ? { title, contentMd, locale } : null;
  });
}

interface PollDraft {
  title: string;
  options: string[];
  allowMultiple: boolean;
  locale: LocaleCode;
}

function readPollDraft(c: Context): Promise<PollDraft | null> {
  return readJson<{
    title?: unknown;
    options?: unknown;
    allowMultiple?: unknown;
    locale?: unknown;
  }>(c).then((body) => {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const rawOptions = body?.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option) => (typeof option === 'string' ? option.trim() : ''))
      : [];
    const locale = body?.locale;
    if (
      !title ||
      !isLocaleCode(locale) ||
      typeof body?.allowMultiple !== 'boolean' ||
      options.length < 2 ||
      options.length > MAX_POLL_OPTIONS ||
      options.some((option) => !option || option.length > MAX_POLL_OPTION_LENGTH)
    ) {
      return null;
    }
    return { title, options, allowMultiple: body.allowMultiple, locale };
  });
}

function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readAnnouncementDraft(c);
    if (!draft) return badRequest(c);
    const serverTime = Date.now();
    const { last_row_id: id } = await env.db
      .prepare(
        `INSERT INTO announcements (locale, title, content_md, sort, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM announcements WHERE locale = ?), ?)`,
      )
      .bind(draft.locale, draft.title, draft.contentMd, draft.locale, serverTime)
      .run();
    const row = await env.db
      .prepare('SELECT sort FROM announcements WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const announcement: Announcement = {
      id,
      locale: draft.locale,
      title: draft.title,
      contentMd: draft.contentMd,
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
    const current = await env.db
      .prepare('SELECT locale FROM announcements WHERE id = ?')
      .bind(id)
      .first<{ locale: LocaleCode }>();
    if (!current) return c.json({ ok: false, error: 'not_found' }, 404);
    if (current.locale !== draft.locale)
      return c.json({ ok: false, error: 'locale_mismatch' }, 409);
    await env.db
      .prepare(
        'UPDATE announcements SET title = ?, content_md = ?, updated_at = ? WHERE id = ? AND locale = ?',
      )
      .bind(draft.title, draft.contentMd, Date.now(), id, draft.locale)
      .run();
    return c.json({ ok: true });
  });

  // Reactions belong to an announcement. Votes are independent poll records.
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

function feedbackApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/reorder', reorderHandler(env.db, 'feedback'));

  app.delete('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    await env.db.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  return app;
}

function pollsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readPollDraft(c);
    if (!draft) return badRequest(c);
    const now = Date.now();
    const result = await env.db
      .prepare(
        `INSERT INTO polls (id, locale, title, options, allow_multiple, sort, created_at, updated_at)
         SELECT COALESCE(MAX(id) + 1, 0), ?, ?, ?, ?,
                COALESCE((SELECT MAX(sort) + 1 FROM polls WHERE locale = ?), 0), ?, ?
         FROM polls`,
      )
      .bind(
        draft.locale,
        draft.title,
        JSON.stringify(draft.options),
        draft.allowMultiple ? 1 : 0,
        draft.locale,
        now,
        now,
      )
      .run();
    const id = result.last_row_id;
    const sort = await env.db
      .prepare('SELECT sort FROM polls WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const poll: Poll = {
      id,
      locale: draft.locale,
      title: draft.title,
      options: draft.options,
      allowMultiple: draft.allowMultiple,
      sort: typeof sort === 'number' ? sort : 0,
      createdAt: now,
      updatedAt: now,
      votes: [],
    };
    return c.json({ ok: true, poll });
  });

  app.post('/reorder', reorderHandler(env.db, 'polls', true));

  app.put('/:id', async (c) => {
    const id = nonNegativeIdParam(c);
    if (id === null) return badRequest(c);
    const draft = await readPollDraft(c);
    if (!draft) return badRequest(c);
    const current = await env.db
      .prepare('SELECT locale, options, allow_multiple FROM polls WHERE id = ?')
      .bind(id)
      .first<{ locale: LocaleCode; options: string; allow_multiple: number }>();
    if (!current) return c.json({ ok: false, error: 'not_found' }, 404);
    if (current.locale !== draft.locale)
      return c.json({ ok: false, error: 'locale_mismatch' }, 409);

    const voteCount = await env.db
      .prepare('SELECT COUNT(*) AS count FROM votes WHERE poll_id = ?')
      .bind(id)
      .first<number>('count');
    const currentOptions = JSON.parse(current.options) as string[];
    const optionsChanged = JSON.stringify(currentOptions) !== JSON.stringify(draft.options);
    const multipleChanged = Boolean(current.allow_multiple) !== draft.allowMultiple;
    if ((optionsChanged || multipleChanged) && Number(voteCount ?? 0) > 0) {
      return c.json({ ok: false, error: 'poll_has_votes' }, 409);
    }

    await env.db
      .prepare(
        'UPDATE polls SET title = ?, options = ?, allow_multiple = ?, updated_at = ? WHERE id = ? AND locale = ?',
      )
      .bind(
        draft.title,
        JSON.stringify(draft.options),
        draft.allowMultiple ? 1 : 0,
        Date.now(),
        id,
        draft.locale,
      )
      .run();
    return c.json({ ok: true });
  });

  app.delete('/:id', async (c) => {
    const id = nonNegativeIdParam(c);
    if (id === null) return badRequest(c);
    await env.db.batch([
      { sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [id] },
      { sql: 'DELETE FROM polls WHERE id = ?', binds: [id] },
    ]);
    return c.json({ ok: true });
  });

  return app;
}

export function adminApp(env: AppEnv): Hono {
  const app = new Hono();
  app.use('*', rootGate(env.db));
  app.route('/announcements', announcementsApp(env));
  app.route('/feedback', feedbackApp(env));
  app.route('/polls', pollsApp(env));
  return app;
}
