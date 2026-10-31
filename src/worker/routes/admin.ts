// Root-only admin write APIs. Snapshot reads come from /sync and are scoped to the active locale.

import { Hono, type Context } from 'hono';
import { parsePollOptions } from '../../shared/poll.ts';
import { type Announcement, type LocaleCode, type Poll, type Vote } from '../../shared/types.ts';
import { isLocaleCode } from '../../shared/copy.ts';
import type { AppEnv } from '../app.ts';
import { badRequest, idParam, readJson, reorderHandler, rootGate } from '../http.ts';
import {
  isOversizedAnnouncement,
  isOversizedTranslation,
  readAnnouncementContent,
  readTranslationRequest,
} from '../translate.ts';

/** Trimmed announcement title/body and explicit language, or null when invalid. */
function readAnnouncementDraft(
  c: Context,
): Promise<{ title: string; contentMd: string; locale: LocaleCode } | null> {
  return readJson<{ title?: unknown; contentMd?: unknown; locale?: unknown }>(c).then((body) => {
    const content = readAnnouncementContent(body);
    const raw = body?.locale;
    const locale = isLocaleCode(raw) ? raw : null;
    return content && locale ? { ...content, locale } : null;
  });
}

/** The full desired vote set for an overwrite; null when the shape is invalid. */
function parseVotes(raw: unknown): Vote[] | null {
  if (!Array.isArray(raw)) return null;
  const votes: Vote[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const { userId, option } = entry as { userId?: unknown; option?: unknown };
    if (
      typeof userId !== 'number' ||
      !Number.isInteger(userId) ||
      userId < 0 ||
      typeof option !== 'number' ||
      !Number.isInteger(option) ||
      option < 0
    )
      return null;
    const key = `${userId}:${option}`;
    if (seen.has(key)) return null;
    seen.add(key);
    votes.push({ userId, option });
  }
  return votes;
}

interface PollDraft {
  options: string[];
  allowMultiple: boolean;
  locale: LocaleCode;
}

/** A poll body for a create: `votes` is not accepted here, only on an overwrite. */
function readPollDraft(c: Context, withVotes: false): Promise<PollDraft | null>;
/** A poll body for an overwrite: the complete vote set to store is required. */
function readPollDraft(
  c: Context,
  withVotes: true,
): Promise<(PollDraft & { votes: Vote[] }) | null>;
function readPollDraft(
  c: Context,
  withVotes: boolean,
): Promise<(PollDraft & { votes: Vote[] | null }) | null> {
  return readJson<{
    options?: unknown;
    allowMultiple?: unknown;
    locale?: unknown;
    votes?: unknown;
  }>(c).then((body) => {
    const options = parsePollOptions(body?.options);
    const raw = body?.locale;
    const locale = isLocaleCode(raw) ? raw : null;
    if (!options || typeof body?.allowMultiple !== 'boolean' || !locale) return null;
    const draft = { options, allowMultiple: body.allowMultiple, locale };
    // A create has nothing to apply votes to; accepting the field would store a poll whose
    // votes were silently dropped.
    if (!withVotes) return body?.votes === undefined ? { ...draft, votes: null } : null;
    const votes = parseVotes(body?.votes);
    return votes ? { ...draft, votes } : null;
  });
}

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

function announcementsApp(env: AppEnv): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const draft = await readAnnouncementDraft(c);
    if (!draft) return badRequest(c);
    if (isOversizedAnnouncement(draft.title, draft.contentMd))
      return c.json({ ok: false, error: 'too_large' }, 413);
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
    if (isOversizedAnnouncement(draft.title, draft.contentMd))
      return c.json({ ok: false, error: 'too_large' }, 413);
    // A row that changes locale joins the target locale's order at its end; keeping the old
    // `sort` would leave two rows on one index, which the snapshot cannot order.
    const result = await env.db
      .prepare(
        `UPDATE announcements SET title = ?, content_md = ?, locale = ?, updated_at = ?,
           sort = CASE WHEN locale = ? THEN sort
                       ELSE (SELECT COALESCE(MAX(sort) + 1, 0) FROM announcements WHERE locale = ?)
                  END
         WHERE id = ?`,
      )
      .bind(draft.title, draft.contentMd, draft.locale, Date.now(), draft.locale, draft.locale, id)
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
    const draft = await readPollDraft(c, false);
    if (!draft) return badRequest(c);
    const serverTime = Date.now();
    const { last_row_id: id } = await env.db
      .prepare(
        `INSERT INTO polls (options, allow_multiple, locale, sort, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM polls WHERE locale = ?), ?)`,
      )
      .bind(
        JSON.stringify(draft.options),
        draft.allowMultiple ? 1 : 0,
        draft.locale,
        draft.locale,
        serverTime,
      )
      .run();
    const row = await env.db
      .prepare('SELECT sort FROM polls WHERE id = ?')
      .bind(id)
      .first<number>('sort');
    const poll: Poll = {
      id,
      options: draft.options,
      allowMultiple: draft.allowMultiple,
      locale: draft.locale,
      sort: typeof row === 'number' ? row : 0,
      updatedAt: serverTime,
      votes: [],
    };
    return c.json({ ok: true, poll });
  });

  app.post('/reorder', reorderHandler(env.db, 'polls'));

  app.put('/:id', async (c) => {
    const id = idParam(c);
    if (id === null) return badRequest(c);
    const draft = await readPollDraft(c, true);
    if (!draft) return badRequest(c);
    const existing = await env.db
      .prepare('SELECT id FROM polls WHERE id = ?')
      .bind(id)
      .first<number>('id');
    if (existing === null) return c.json({ ok: false, error: 'not_found' }, 404);

    // The admin supplies the whole poll: every vote already addresses an option in the new
    // list, so this is a straight overwrite. The only invariants checked are that the indices
    // exist and that a single-choice poll has at most one vote per user.
    const voters = new Set<number>();
    for (const vote of draft.votes) {
      if (vote.option >= draft.options.length) return badRequest(c);
      if (!draft.allowMultiple && voters.has(vote.userId)) return badRequest(c);
      voters.add(vote.userId);
    }
    await env.db.batch([
      {
        // A row that changes locale joins the target locale's order at its end; keeping the
        // old `sort` would leave two rows on one index, which the snapshot cannot order.
        sql: `UPDATE polls SET options = ?, allow_multiple = ?, locale = ?, updated_at = ?,
                sort = CASE WHEN locale = ? THEN sort
                            ELSE (SELECT COALESCE(MAX(sort) + 1, 0) FROM polls WHERE locale = ?)
                       END
              WHERE id = ?`,
        binds: [
          JSON.stringify(draft.options),
          draft.allowMultiple ? 1 : 0,
          draft.locale,
          Date.now(),
          draft.locale,
          draft.locale,
          id,
        ],
      },
      { sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [id] },
      ...draft.votes.map((vote) => ({
        sql: 'INSERT INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)',
        binds: [id, vote.userId, vote.option],
      })),
    ]);
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
  app.post('/translate', translateHandler(env));
  app.route('/announcements', announcementsApp(env));
  app.route('/polls', pollsApp(env));
  app.route('/feedback', feedbackApp(env));
  return app;
}
