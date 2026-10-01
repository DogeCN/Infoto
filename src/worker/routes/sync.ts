// POST /sync — the single write entry point. Applies every op in array order, then
// returns the full state snapshot. Ops from a non-root identity that need root powers
// are dropped, and a failing op never aborts the rest of the batch.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import type { Db } from '../db.ts';
import {
  MEDIA_TYPE,
  MAX_SYNC_OPS,
  type Announcement,
  type Feedback,
  type LocaleCode,
  type MediaType,
  type Op,
  type Photo,
  type Poll,
  type SyncRequest,
} from '../../shared/types.ts';
import { ROOT_ID, createUser, resolveUser, sessionCookie, type UserRow } from '../identity.ts';
import { verifyTurnstile } from '../turnstile.ts';
import { locales } from '../../shared/copy.ts';
import { LOCAL_MEDIA_HOST_URL, isAllowedMediaUrl } from './media.ts';

/** Text fields an anonymous op may carry. */
const MAX_TEXT_LENGTH = 20_000;
const MAX_EMOJI_LENGTH = 16;
/** Maximum number of options accepted by one poll. */
const MAX_VOTE_OPTIONS = 100;

/** Mark column holding the user ids that applied a mark. */
type MarkColumn = 'likes' | 'dislikes' | 'reports';

interface PhotoRow {
  id: number;
  sha256: string;
  url: string;
  uploader: number;
  width: number;
  height: number;
  size: number;
  created_at: number;
  type: number;
  likes: string;
  dislikes: string;
  reports: string;
}
interface AnnRow {
  id: number;
  title: string;
  content_md: string;
  locale: LocaleCode;
  sort: number;
  updated_at: number;
}
interface PollRow {
  id: number;
  title: string;
  options: string;
  allow_multiple: number;
  locale: LocaleCode;
  sort: number;
}
interface FbRow {
  id: number;
  user_id: number;
  content_md: string;
  created_at: number;
  locale: LocaleCode;
  sort: number;
}
interface ReactRow {
  ann_id: number;
  user_id: number;
  emoji: string;
}
interface VoteRow {
  poll_id: number;
  user_id: number;
  option: number;
}

/** User ids out of a JSON mark column; a malformed column reads as an empty list. */
const idList = (json: string): number[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

const record = (p: Op['payload']): Record<string, unknown> =>
  p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
/** Non-empty string within `max` characters, or null. */
const text = (v: unknown, max = MAX_TEXT_LENGTH): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
/** Non-negative integer, or null. */
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const mediaType = (v: unknown): MediaType | null =>
  v === MEDIA_TYPE.IMAGE || v === MEDIA_TYPE.ANIMATED || v === MEDIA_TYPE.VIDEO ? v : null;
const localeCode = (v: unknown): v is LocaleCode =>
  typeof v === 'string' && Object.hasOwn(locales, v);

/** Photo id for an op's `targetSha`, or null when the hash matches no row. */
async function resolvePhotoId(db: Db, op: Op): Promise<number | null> {
  if (!op.targetSha) return null;
  const row = await db.prepare('SELECT id FROM photos WHERE sha256 = ?').bind(op.targetSha).first();
  return row ? Number(row.id) : null;
}

/** Add or remove `userId` in one mark column. The membership test and the write are a
 * single statement, so two concurrent marks on one photo cannot drop each other. */
async function setMark(
  db: Db,
  photoId: number | null,
  userId: number,
  col: MarkColumn,
  add: boolean,
): Promise<void> {
  if (photoId === null) return;
  const sql = add
    ? `UPDATE photos SET ${col} = CASE
         WHEN EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?) THEN ${col}
         ELSE json_insert(${col}, '$[#]', ?) END
       WHERE id = ?`
    : `UPDATE photos SET ${col} = CASE
         WHEN NOT EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?) THEN ${col}
         ELSE (SELECT json_group_array(value) FROM json_each(${col}) WHERE value <> ?) END
       WHERE id = ?`;
  await db.prepare(sql).bind(userId, userId, photoId).run();
}

/** True when the row exists, so an op never creates an orphan reaction or vote. */
async function announcementExists(db: Db, id: number): Promise<boolean> {
  return (await db.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first()) !== null;
}

async function applyOp(env: AppEnv, user: UserRow, op: Op, serverTime: number): Promise<void> {
  const db = env.db;
  const isRoot = user.id === ROOT_ID;
  switch (op.type) {
    case 'upload': {
      const p = record(op.payload);
      const sha256 = text(p.sha256, 128);
      const url = text(p.url, 2048);
      const width = count(p.width);
      const height = count(p.height);
      const size = count(p.size);
      const type = mediaType(p.type);
      if (!sha256 || !url || width === null || height === null || size === null) return;
      if (type === null) return;
      // Must match the read proxy's rule, or a locally uploaded photo is stored and then
      // refused by /l/:id36 (or, before this was shared, dropped right here).
      if (!isAllowedMediaUrl(env, url)) return;
      if (await env.db.prepare('SELECT id FROM photos WHERE sha256 = ?').bind(sha256).first())
        return;
      await db
        .prepare(
          `INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(sha256, url, user.id, width, height, size, serverTime, type)
        .run();
      return;
    }
    case 'like':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'likes', true);
    case 'unlike':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'likes', false);
    case 'dislike':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'dislikes', true);
    case 'undislike':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'dislikes', false);
    case 'report':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'reports', true);
    case 'unreport':
      return setMark(db, await resolvePhotoId(db, op), user.id, 'reports', false);
    case 'delete': {
      if (!isRoot) return;
      const photoId = await resolvePhotoId(db, op);
      if (photoId === null) return;
      await db.prepare('DELETE FROM photos WHERE id = ?').bind(photoId).run();
      return;
    }
    case 'fb_create': {
      const payload = record(op.payload);
      const contentMd = text(payload.contentMd);
      const locale = localeCode(payload.locale) ? payload.locale : null;
      if (!contentMd || !locale) return;
      // One below this locale's current minimum, so the newest row sorts first.
      await db
        .prepare(
          `INSERT INTO feedback (user_id, content_md, created_at, locale, sort)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MIN(sort), 0) - 1 FROM feedback WHERE locale = ?))`,
        )
        .bind(user.id, contentMd, serverTime, locale, locale)
        .run();
      return;
    }
    case 'react': {
      const annId = op.target;
      if (annId == null || !(await announcementExists(db, annId))) return;
      const emoji = text(record(op.payload).emoji, MAX_EMOJI_LENGTH);
      if (emoji) {
        await db
          .prepare('INSERT OR REPLACE INTO reactions (ann_id, user_id, emoji) VALUES (?, ?, ?)')
          .bind(annId, user.id, emoji)
          .run();
      } else {
        await db
          .prepare('DELETE FROM reactions WHERE ann_id = ? AND user_id = ?')
          .bind(annId, user.id)
          .run();
      }
      return;
    }
    case 'vote': {
      const pollId = op.target;
      if (pollId == null) return;
      const poll = await db
        .prepare('SELECT options, allow_multiple FROM polls WHERE id = ?')
        .bind(pollId)
        .first<{ options: string; allow_multiple: number }>();
      if (!poll) return;
      let optionCount: number;
      try {
        const options: unknown = JSON.parse(poll.options);
        if (!Array.isArray(options)) return;
        optionCount = options.length;
      } catch {
        return;
      }
      const rawOptions = record(op.payload).options;
      if (!Array.isArray(rawOptions) || rawOptions.length > MAX_VOTE_OPTIONS) return;
      const options: number[] = [];
      for (const raw of rawOptions) {
        const option = count(raw);
        if (option === null || option >= optionCount) return;
        options.push(option);
      }
      if (new Set(options).size !== options.length || (!poll.allow_multiple && options.length > 1))
        return;
      await db.batch([
        { sql: 'DELETE FROM votes WHERE poll_id = ? AND user_id = ?', binds: [pollId, user.id] },
        ...options.map((option) => ({
          sql: 'INSERT INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)',
          binds: [pollId, user.id, option],
        })),
      ]);
      return;
    }
  }
}

/** Apply the batch, dropping an op that throws without affecting the others. */
async function applyOps(env: AppEnv, user: UserRow, ops: Op[], serverTime: number): Promise<void> {
  for (const op of ops) {
    if (!op || typeof op.type !== 'string') continue;
    try {
      await applyOp(env, user, op, serverTime);
    } catch (e) {
      console.error('[sync] op dropped', op.type, e);
    }
  }
}

const rowToPhoto = (r: PhotoRow): Photo => ({
  id: r.id,
  sha256: r.sha256,
  url: r.url,
  uploader: r.uploader,
  width: r.width,
  height: r.height,
  size: r.size,
  createdAt: r.created_at,
  type: mediaType(r.type) ?? MEDIA_TYPE.IMAGE,
  likes: idList(r.likes),
  dislikes: idList(r.dislikes),
  reports: idList(r.reports),
});

/** Group rows by their owning entity ID, preserving the query order. */
function groupById<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = out.get(id);
    if (list) list.push(row);
    else out.set(id, [row]);
  }
  return out;
}

async function snapshot(
  db: Db,
  selfId: number,
  locale: LocaleCode,
): Promise<{
  photos: Photo[];
  announcements: Announcement[];
  polls: Poll[];
  feedback: Feedback[];
}> {
  const [photoRows, annRows, pollRows, reactRows, voteRows] = await Promise.all([
    db.prepare('SELECT * FROM photos ORDER BY id ASC').all<PhotoRow>(),
    db
      .prepare('SELECT * FROM announcements WHERE locale = ? ORDER BY sort ASC, id ASC')
      .bind(locale)
      .all<AnnRow>(),
    db
      .prepare('SELECT * FROM polls WHERE locale = ? ORDER BY sort ASC, id ASC')
      .bind(locale)
      .all<PollRow>(),
    db.prepare('SELECT ann_id, user_id, emoji FROM reactions').all<ReactRow>(),
    db.prepare('SELECT poll_id, user_id, option FROM votes').all<VoteRow>(),
  ]);
  const reactions = groupById(reactRows.results, (r) => r.ann_id);
  const votes = groupById(voteRows.results, (r) => r.poll_id);
  const announcements: Announcement[] = annRows.results.map((r) => ({
    id: r.id,
    title: r.title,
    contentMd: r.content_md,
    locale: r.locale,
    sort: r.sort,
    updatedAt: r.updated_at,
    reactions: (reactions.get(r.id) ?? []).map((x) => ({ userId: x.user_id, emoji: x.emoji })),
  }));
  const polls: Poll[] = pollRows.results.map((r) => {
    let options: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r.options);
      if (Array.isArray(parsed))
        options = parsed.filter((option): option is string => typeof option === 'string');
    } catch {
      options = [];
    }
    return {
      id: r.id,
      title: r.title,
      options,
      allowMultiple: r.allow_multiple === 1,
      locale: r.locale,
      sort: r.sort,
      votes: (votes.get(r.id) ?? []).map((x) => ({ userId: x.user_id, option: x.option })),
    };
  });
  let feedback: Feedback[] = [];
  if (selfId === ROOT_ID) {
    const rows = await db
      .prepare('SELECT * FROM feedback WHERE locale = ? ORDER BY sort ASC, id ASC')
      .bind(locale)
      .all<FbRow>();
    feedback = rows.results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      contentMd: r.content_md,
      createdAt: r.created_at,
      sort: r.sort,
      locale: r.locale,
    }));
  }
  return { photos: photoRows.results.map(rowToPhoto), announcements, polls, feedback };
}

export function syncHandler(env: AppEnv) {
  return async (c: Context): Promise<Response> => {
    let body: SyncRequest;
    try {
      body = (await c.req.json()) as SyncRequest;
    } catch {
      return c.json({ ok: false, error: 'bad_request' }, 400);
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.ops)) {
      return c.json({ ok: false, error: 'bad_request' }, 400);
    }
    const locale = localeCode(body.locale) ? body.locale : null;
    if (!locale) return c.json({ ok: false, error: 'bad_request' }, 400);
    if (body.ops.length > MAX_SYNC_OPS) {
      return c.json({ ok: false, error: 'too_many_ops' }, 413);
    }

    let user = await resolveUser(env.db, c.req.header('cookie'));
    if (!user) {
      // Creating an identity requires a Turnstile token; the 401 body carries the
      // public site key the page renders the widget with.
      const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
      if (!token) {
        return c.json(
          {
            ok: false,
            error: 'turnstile_required',
            turnstileSiteKey: env.turnstileSiteKey ?? null,
          },
          401,
        );
      }
      const passed = await verifyTurnstile(
        token,
        env.turnstileSecret,
        c.req.header('cf-connecting-ip'),
      );
      if (!passed) return c.json({ ok: false, error: 'turnstile_failed' }, 401);
      user = await createUser(env.db);
    }

    const serverTime = Date.now();
    await applyOps(env, user, body.ops, serverTime);

    const snap = await snapshot(env.db, user.id, locale);
    const res = c.json({
      ok: true,
      serverTime,
      selfId: user.id,
      locale,
      // Uploads go straight from the browser to the facade; this server only stores the
      // URL it hands back.
      mediaHostUrl: env.mediaHostUrl ?? LOCAL_MEDIA_HOST_URL,
      ...snap,
    });
    res.headers.set('Set-Cookie', sessionCookie(user.uuid, c.req.raw));
    return res;
  };
}
