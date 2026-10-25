// POST /sync — the single write entry point. Applies every op in array order, then
// returns the full state snapshot. Ops from a non-root identity that need root powers
// are dropped, and a failing op never aborts the rest of the batch.

import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import type { Db, DbStatement } from '../db.ts';
import {
  MEDIA_TYPE,
  MAX_POLL_OPTIONS,
  MAX_SYNC_OPS,
  MAX_TEXT_LENGTH,
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
import { isLocaleCode } from '../../shared/copy.ts';
import { isRecord, safeJsonParse } from '../../shared/json.ts';
import { isAllowedMediaUrl } from './media.ts';

/** Longest emoji an anonymous op may carry. */
const MAX_EMOJI_LENGTH = 16;
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
  options: string;
  allow_multiple: number;
  locale: LocaleCode;
  sort: number;
  updated_at: number;
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
  const v = safeJsonParse<unknown>(json, []);
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
};

const record = (p: Op['payload']): Record<string, unknown> => (isRecord(p) ? p : {});
/** Non-empty string within `max` characters, or null. */
const text = (v: unknown, max = MAX_TEXT_LENGTH): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
/** Non-negative integer, or null. */
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const mediaType = (v: unknown): MediaType | null =>
  v === MEDIA_TYPE.IMAGE || v === MEDIA_TYPE.ANIMATED || v === MEDIA_TYPE.VIDEO ? v : null;

/** Statements per `db.batch` call. One call is one round trip, and every op below becomes a
 *  fixed one or two statements, so a request's cost is a small multiple of this constant
 *  instead of a round trip per op — the difference between a 200-photo sync finishing and
 *  the page giving up on it. */
const MAX_BATCH_STATEMENTS = 100;

/** The column an attitude's opposite writes: a like and a dislike are one choice, never both. */
const OPPOSITE_MARK: Partial<Record<MarkColumn, MarkColumn>> = {
  likes: 'dislikes',
  dislikes: 'likes',
};

/** `col = col ∪ {userId}`, without a duplicate entry. */
const addMarkSql = (col: MarkColumn): string => `${col} = CASE
    WHEN EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?) THEN ${col}
    ELSE json_insert(${col}, '$[#]', ?) END`;

/** `col = col ∖ {userId}`, a no-op when the user is not in it. */
const removeMarkSql = (col: MarkColumn): string => `${col} = CASE
    WHEN NOT EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?) THEN ${col}
    ELSE (SELECT json_group_array(value) FROM json_each(${col}) WHERE value <> ?) END`;

/**
 * Add or remove `userId` in one mark column, as one statement addressed by sha256 — the
 * membership test and the write travel together, so two concurrent marks on one photo cannot
 * drop each other, and no lookup of the photo's row is needed first.
 *
 * Adding a like or a dislike also clears the opposite column in that same statement. The two
 * are one choice, and the server owns that invariant instead of trusting every client to send
 * the paired removal, so a client can state a switch with one op. Reports stand alone and may
 * coexist with either.
 */
function markStatement(userId: number, col: MarkColumn, add: boolean, sha256: string): DbStatement {
  const sets = [add ? addMarkSql(col) : removeMarkSql(col)];
  const opposite = add ? OPPOSITE_MARK[col] : undefined;
  if (opposite) sets.push(removeMarkSql(opposite));
  return {
    sql: `UPDATE photos SET ${sets.join(', ')} WHERE sha256 = ?`,
    binds: [...sets.flatMap(() => [userId, userId]), sha256],
  };
}

/** The mark statements for one op, or none when it carries no hash to address. */
function markOp(userId: number, col: MarkColumn, add: boolean, op: Op): DbStatement[] {
  return op.targetSha ? [markStatement(userId, col, add, op.targetSha)] : [];
}

interface PollDefinition {
  options: string;
  allow_multiple: number;
}

/** D1's per-query cap on bound parameters is 100 (`d1/platform/limits`). `MAX_SYNC_OPS` lets one
 *  request vote on more distinct polls than that, so this read is sliced rather than built whole. */
const MAX_BOUND_PARAMS = 100;

/**
 * The poll rows a batch votes on, read before any write.
 *
 * A poll is created by the admin endpoints and never by a sync op, so this answer cannot be
 * changed by the ops that consume it — which is what lets every vote in the batch validate
 * against it up front and contribute statements to a single batch instead of a read of its own.
 */
async function loadPolls(db: Db, ops: Op[]): Promise<Map<number, PollDefinition>> {
  const ids = new Set<number>();
  for (const op of ops) {
    if (op?.type === 'vote' && typeof op.target === 'number') ids.add(op.target);
  }
  const list = [...ids];
  const out = new Map<number, PollDefinition>();
  for (let offset = 0; offset < list.length; offset += MAX_BOUND_PARAMS) {
    const slice = list.slice(offset, offset + MAX_BOUND_PARAMS);
    const rows = await db
      .prepare(
        `SELECT id, options, allow_multiple FROM polls WHERE id IN (${slice.map(() => '?').join(', ')})`,
      )
      .bind(...slice)
      .all<PollDefinition & { id: number }>();
    for (const row of rows.results) out.set(row.id, row);
  }
  return out;
}

/**
 * The statements one op contributes, in the album's own order.
 *
 * Validation happens here, in JS, so a malformed op contributes nothing and cannot roll back
 * the writes of the ops beside it. Photo ops address their photo by sha256 — the stable unique
 * index — so no op needs a lookup of its own first, and an op that arrives after the upload
 * which creates its row still applies: the statements keep the order the ops arrived in.
 */
function planOp(
  env: AppEnv,
  user: UserRow,
  op: Op,
  serverTime: number,
  polls: Map<number, PollDefinition>,
): DbStatement[] {
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
      // The client reports when the facade returned the URL. It is the only source of a
      // per-photo timestamp: `serverTime` is read once for the whole request, so a batch of
      // uploads would otherwise share one millisecond and "latest" could not order them.
      // Bounded by the server clock so a skewed or forged value cannot pin a photo into the
      // future; `uploader` stays server-authoritative.
      const createdAt = count(p.createdAt);
      if (!sha256 || !url || width === null || height === null || size === null) return [];
      if (type === null || createdAt === null || createdAt === 0) return [];
      // Keep upload URL validation consistent with the read proxy.
      if (!isAllowedMediaUrl(env, url)) return [];
      // The duplicate check travels inside the insert: a hash already in the album — including
      // one an earlier op of this same batch just inserted — writes nothing, so a re-sent batch
      // stays silent and no unique violation can reach the transaction.
      return [
        {
          sql: `INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM photos WHERE sha256 = ?)`,
          binds: [
            sha256,
            url,
            user.id,
            width,
            height,
            size,
            Math.min(createdAt, serverTime),
            type,
            sha256,
          ],
        },
      ];
    }
    case 'like':
      return markOp(user.id, 'likes', true, op);
    case 'unlike':
      return markOp(user.id, 'likes', false, op);
    case 'dislike':
      return markOp(user.id, 'dislikes', true, op);
    case 'undislike':
      return markOp(user.id, 'dislikes', false, op);
    case 'report':
      return markOp(user.id, 'reports', true, op);
    case 'unreport':
      return markOp(user.id, 'reports', false, op);
    case 'delete':
      // Root-only, and addressable by hash like every other photo op.
      return isRoot && op.targetSha
        ? [{ sql: 'DELETE FROM photos WHERE sha256 = ?', binds: [op.targetSha] }]
        : [];
    case 'fb_create': {
      const payload = record(op.payload);
      const contentMd = text(payload.contentMd);
      const locale = isLocaleCode(payload.locale) ? payload.locale : null;
      if (!contentMd || !locale) return [];
      // One below this locale's current minimum, so the newest row sorts first.
      return [
        {
          sql: `INSERT INTO feedback (user_id, content_md, created_at, locale, sort)
                VALUES (?, ?, ?, ?, (SELECT COALESCE(MIN(sort), 0) - 1 FROM feedback WHERE locale = ?))`,
          binds: [user.id, contentMd, serverTime, locale, locale],
        },
      ];
    }
    case 'react': {
      const annId = op.target;
      if (annId == null) return [];
      const emoji = text(record(op.payload).emoji, MAX_EMOJI_LENGTH);
      // An emoji only lands on an announcement that exists: the test travels inside the
      // insert, so neither a lookup nor an orphan row is possible.
      if (emoji)
        return [
          {
            sql: `INSERT OR REPLACE INTO reactions (ann_id, user_id, emoji)
                  SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM announcements WHERE id = ?)`,
            binds: [annId, user.id, emoji, annId],
          },
        ];
      // Clearing a reaction needs no existence test: a delete only ever matches rows that exist.
      return [
        {
          sql: 'DELETE FROM reactions WHERE ann_id = ? AND user_id = ?',
          binds: [annId, user.id],
        },
      ];
    }
    case 'vote': {
      const pollId = op.target;
      if (pollId == null) return [];
      const poll = polls.get(pollId);
      if (!poll) return [];
      let optionCount: number;
      try {
        const options: unknown = JSON.parse(poll.options);
        if (!Array.isArray(options)) return [];
        optionCount = options.length;
      } catch {
        return [];
      }
      const rawOptions = record(op.payload).options;
      if (!Array.isArray(rawOptions) || rawOptions.length > MAX_POLL_OPTIONS) return [];
      const options: number[] = [];
      for (const raw of rawOptions) {
        const option = count(raw);
        if (option === null || option >= optionCount) return [];
        options.push(option);
      }
      if (new Set(options).size !== options.length || (!poll.allow_multiple && options.length > 1))
        return [];
      return [
        { sql: 'DELETE FROM votes WHERE poll_id = ? AND user_id = ?', binds: [pollId, user.id] },
        ...options.map((option) => ({
          sql: 'INSERT INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)',
          binds: [pollId, user.id, option],
        })),
      ];
    }
    default:
      // An op type this deployment does not know — a page newer than the server — writes nothing.
      return [];
  }
}

/**
 * Plan every op, then write the plan in a fixed handful of transactions.
 *
 * Each op below is one or two statements, so what a request costs is the statement count
 * divided by `MAX_BATCH_STATEMENTS` — not a round trip per op, which is what let a 200-photo
 * upload outlast the page's patience for the response. A chunk is one transaction and its ops
 * are independent, so a chunk that fails is dropped on its own, leaving the others applied.
 */
async function applyOps(env: AppEnv, user: UserRow, ops: Op[], serverTime: number): Promise<void> {
  const polls = await loadPolls(env.db, ops);
  const statements: DbStatement[] = [];
  for (const op of ops) {
    if (!op || typeof op.type !== 'string') continue;
    try {
      statements.push(...planOp(env, user, op, serverTime, polls));
    } catch (e) {
      console.error('[sync] op dropped', op.type, e);
    }
  }
  for (let offset = 0; offset < statements.length; offset += MAX_BATCH_STATEMENTS) {
    const chunk = statements.slice(offset, offset + MAX_BATCH_STATEMENTS);
    try {
      await env.db.batch(chunk);
    } catch (e) {
      console.error('[sync] ops dropped', chunk.length, e);
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

/** Every locale's content rows: the client filters by its content locale, so a language
 *  switch is a local re-render rather than another round trip. Photos are locale-neutral. */
async function snapshot(
  db: Db,
  selfId: number,
): Promise<{
  photos: Photo[];
  announcements: Announcement[];
  polls: Poll[];
  feedback: Feedback[];
}> {
  const [photoRows, annRows, pollRows, reactRows, voteRows] = await Promise.all([
    db.prepare('SELECT * FROM photos ORDER BY id ASC').all<PhotoRow>(),
    db.prepare('SELECT * FROM announcements ORDER BY sort ASC').all<AnnRow>(),
    db.prepare('SELECT * FROM polls ORDER BY sort ASC').all<PollRow>(),
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
      options,
      allowMultiple: r.allow_multiple === 1,
      locale: r.locale,
      sort: r.sort,
      updatedAt: r.updated_at,
      votes: (votes.get(r.id) ?? []).map((x) => ({ userId: x.user_id, option: x.option })),
    };
  });
  let feedback: Feedback[] = [];
  if (selfId === ROOT_ID) {
    const rows = await db.prepare('SELECT * FROM feedback ORDER BY sort ASC').all<FbRow>();
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

    const snap = await snapshot(env.db, user.id);
    const res = c.json({
      ok: true,
      serverTime,
      selfId: user.id,
      // Uploads go straight from the browser to the facade; this server only stores the
      // URL it hands back. `MEDIA_HOST_URL` is the only source — a deployment always has
      // it (the deploy workflow exits 1 without it) and dev gets it from `.dev.vars`, so
      // there is no default to fall back to and no second place to keep in sync.
      mediaHostUrl: env.mediaHostUrl ?? '',
      ...snap,
    });
    res.headers.set('Set-Cookie', sessionCookie(user.uuid, c.req.raw));
    return res;
  };
}
