// The album state machine (ADR 0026): pure appliers that fold one op into the in-memory
// snapshot the Durable Object serves, plus the D1 edge — hydration on a cold object and
// incremental upserts when ops leave the hot path. The DO's op log is the hot store; D1
// stays snapshot-shaped and is only touched at these edges.

import type {
  AlbumSnapshot,
  Announcement,
  AppliedOp,
  Feedback,
  LocaleCode,
  MediaType,
  Op,
  Photo,
  Poll,
} from '../shared/types.ts';
import { MEDIA_TYPE, MAX_POLL_OPTIONS, MAX_TEXT_LENGTH } from '../shared/types.ts';
import { ROOT_ID } from './identity.ts';
import type { Db, DbStatement } from './db.ts';
import { isLocaleCode } from '../shared/copy.ts';
import { isRecord, safeJsonParse } from '../shared/json.ts';
import { isAllowedMediaUrl } from './routes/media.ts';

/** Longest emoji an anonymous op may carry. */
const MAX_EMOJI_LENGTH = 16;

/** Mark column holding the user ids that applied a mark. */
type MarkColumn = 'likes' | 'dislikes' | 'reports';

// ---------- shared validation helpers ----------

const record = (p: Op['payload']): Record<string, unknown> => (isRecord(p) ? p : {});
/** Non-empty string within `max` characters, or null. */
const text = (v: unknown, max = MAX_TEXT_LENGTH): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
/** Non-negative integer, or null. */
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const mediaType = (v: unknown): MediaType | null =>
  v === MEDIA_TYPE.IMAGE || v === MEDIA_TYPE.ANIMATED || v === MEDIA_TYPE.VIDEO ? v : null;
const idList = (json: string): number[] => {
  const v = safeJsonParse<unknown>(json, []);
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
};

/** The next free integer id of an id-keyed collection (1-based, D1-compatible). */
const nextId = (rows: Array<{ id: number }>): number =>
  rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;

/** Write the server-allocated id back onto the create op's payload. The op that is
 *  persisted and broadcast is this same object, so the id travels with it and every
 *  client's optimistic row can be replaced by the real one. */
function stampId(op: Op, id: number): void {
  const payload = isRecord(op.payload) ? op.payload : {};
  (payload as Record<string, unknown>).id = id;
}

/** Which ops a non-root actor may apply; everything admin-shaped is root-only. Ops that
 *  never apply are never stored — the Durable Object refuses them before the log, or they
 *  would reach D1 on the next archive. */
export function authorized(op: Op, userId: number): boolean {
  switch (op.type) {
    case 'ann_create':
    case 'ann_update':
    case 'ann_delete':
    case 'ann_reorder':
    case 'poll_create':
    case 'poll_update':
    case 'poll_delete':
    case 'poll_reorder':
    case 'fb_delete':
    case 'fb_reorder':
    case 'delete':
      return userId === ROOT_ID;
    default:
      return true;
  }
}

/**
 * Fold one op into the snapshot, in place.
 *
 * Validation happens here so a malformed op contributes nothing; an unauthorized op is
 * dropped the same way. Ids and display order are allocated from the snapshot itself —
 * the Durable Object is the single writer, so no read-back is needed. The op's `ts` is
 * the authoritative server stamp; `ct` (the client's commit time, when it carries one)
 * only ever pulls a display time backwards, never into the future.
 *
 * Returns true when the op changed the snapshot, false when it was dropped (unknown
 * target, malformed payload, unauthorized) — a dropped op is still broadcast with its
 * seq, so ordering stays dense for every client.
 */
export function applySnapshotOp(
  snap: AlbumSnapshot,
  user: { id: number },
  op: Op,
  ts: number,
  ctx: { mediaHostUrl?: string } = {},
): boolean {
  if (!op || typeof op.type !== 'string' || !authorized(op, user.id)) return false;
  const shown =
    typeof op.ct === 'number' && Number.isFinite(op.ct) && op.ct > 0 ? Math.min(op.ct, ts) : ts;
  switch (op.type) {
    case 'upload': {
      const p = record(op.payload);
      delete p.id;
      const sha256 = text(p.sha256, 128);
      const url = text(p.url, 2048);
      const width = count(p.width);
      const height = count(p.height);
      const size = count(p.size);
      const type = mediaType(p.type);
      const createdAt = count(p.createdAt);
      if (!sha256 || !url || width === null || height === null || size === null) return false;
      if (type === null || createdAt === null || createdAt === 0) return false;
      // Keep upload URL validation consistent with the read proxy.
      if (!isAllowedMediaUrl(ctx, url)) return false;
      const existing = snap.photos.find((photo) => photo.sha256 === sha256);
      if (existing) {
        stampId(op, existing.id);
        return false;
      }
      const id = nextId(snap.photos);
      stampId(op, id);
      snap.photos.push({
        id,
        sha256,
        url,
        uploader: user.id,
        width,
        height,
        size,
        // Bounded by the server stamp: a skewed or forged clock cannot pin a photo into
        // the future, and an offline capture keeps its real moment.
        createdAt: Math.min(createdAt, ts),
        type,
        likes: [],
        dislikes: [],
        reports: [],
      });
      return true;
    }
    case 'like':
    case 'unlike':
    case 'dislike':
    case 'undislike':
    case 'report':
    case 'unreport':
      return applyMark(snap, user.id, op);
    case 'delete': {
      if (!op.targetSha) return false;
      const before = snap.photos.length;
      snap.photos = snap.photos.filter((photo) => photo.sha256 !== op.targetSha);
      return snap.photos.length !== before;
    }
    case 'vote': {
      const poll = snap.polls.find((p) => p.id === op.target);
      if (!poll) return false;
      const rawOptions = record(op.payload).options;
      if (!Array.isArray(rawOptions) || rawOptions.length > MAX_POLL_OPTIONS) return false;
      const options: number[] = [];
      for (const raw of rawOptions) {
        const option = count(raw);
        if (option === null || option >= poll.options.length) return false;
        options.push(option);
      }
      if (new Set(options).size !== options.length) return false;
      if (!poll.allowMultiple && options.length > 1) return false;
      poll.votes = poll.votes.filter((v) => v.userId !== user.id);
      for (const option of options) poll.votes.push({ userId: user.id, option });
      return true;
    }
    case 'fb_create': {
      const payload = record(op.payload);
      const contentMd = text(payload.contentMd);
      const locale = isLocaleCode(payload.locale) ? payload.locale : null;
      if (!contentMd || !locale) return false;
      const inLocale = snap.feedback.filter((f) => f.locale === locale);
      const sort = inLocale.length > 0 ? Math.min(...inLocale.map((f) => f.sort)) - 1 : 0;
      const id = nextId(snap.feedback);
      snap.feedback.push({
        id,
        userId: user.id,
        contentMd,
        createdAt: shown,
        sort,
        locale,
      });
      stampId(op, id);
      return true;
    }
    case 'fb_delete': {
      const id = count(op.target);
      if (id === null) return false;
      const before = snap.feedback.length;
      snap.feedback = snap.feedback.filter((f) => f.id !== id);
      return snap.feedback.length !== before;
    }
    case 'fb_reorder':
      return applyReorder(snap.feedback, op, (f) => f.locale);
    case 'react': {
      const annId = op.target;
      if (annId == null) return false;
      const announcement = snap.announcements.find((a) => a.id === annId);
      if (!announcement) return false;
      const emoji = text(record(op.payload).emoji, MAX_EMOJI_LENGTH);
      announcement.reactions = announcement.reactions.filter((r) => r.userId !== user.id);
      if (emoji) announcement.reactions.push({ userId: user.id, emoji });
      return true;
    }
    case 'ann_create': {
      const draft = readAnnouncementDraft(record(op.payload));
      if (!draft) return false;
      const inLocale = snap.announcements.filter((a) => a.locale === draft.locale);
      const id = nextId(snap.announcements);
      snap.announcements.push({
        id,
        title: draft.title,
        contentMd: draft.contentMd,
        locale: draft.locale,
        sort: inLocale.length > 0 ? Math.max(...inLocale.map((a) => a.sort)) + 1 : 0,
        updatedAt: ts,
        reactions: [],
      });
      // The allocated id rides back on the op: the broadcasting DO persists and fans out
      // this same object, and every client turns its optimistic row into the real one from it.
      stampId(op, id);
      return true;
    }
    case 'ann_update': {
      const id = count(op.target);
      const draft = id === null ? null : readAnnouncementDraft(record(op.payload));
      if (!draft) return false;
      const row = snap.announcements.find((a) => a.id === id);
      if (!row) return false;
      // A row that changes locale joins the target locale's order at its end; keeping the
      // old sort would leave two rows on one index, which the snapshot cannot order.
      const inLocale = snap.announcements.filter((a) => a.locale === draft.locale && a.id !== id);
      row.title = draft.title;
      row.contentMd = draft.contentMd;
      row.locale = draft.locale;
      row.sort = inLocale.length > 0 ? Math.max(...inLocale.map((a) => a.sort)) + 1 : 0;
      row.updatedAt = ts;
      return true;
    }
    case 'ann_delete': {
      const id = count(op.target);
      if (id === null) return false;
      const before = snap.announcements.length;
      snap.announcements = snap.announcements.filter((a) => a.id !== id);
      return snap.announcements.length !== before;
    }
    case 'ann_reorder':
      return applyReorder(snap.announcements, op, (a) => a.locale);
    case 'poll_create': {
      const draft = readPollDraft(record(op.payload), false);
      if (!draft) return false;
      const inLocale = snap.polls.filter((p) => p.locale === draft.locale);
      const id = nextId(snap.polls);
      snap.polls.push({
        id,
        options: draft.options,
        allowMultiple: draft.allowMultiple,
        locale: draft.locale,
        sort: inLocale.length > 0 ? Math.max(...inLocale.map((p) => p.sort)) + 1 : 0,
        updatedAt: ts,
        votes: [],
      });
      stampId(op, id);
      return true;
    }
    case 'poll_update': {
      const id = count(op.target);
      const draft = id === null ? null : readPollDraft(record(op.payload), true);
      if (!draft) return false;
      const row = snap.polls.find((p) => p.id === id);
      if (!row) return false;
      // The admin supplies the whole poll: every vote already addresses an option in the
      // new list, and a single-choice poll keeps at most one vote per user.
      const voters = new Set<number>();
      for (const vote of draft.votes) {
        if (vote.option >= draft.options.length) return false;
        if (!draft.allowMultiple && voters.has(vote.userId)) return false;
        voters.add(vote.userId);
      }
      const inLocale = snap.polls.filter((p) => p.locale === draft.locale && p.id !== id);
      row.options = draft.options;
      row.allowMultiple = draft.allowMultiple;
      row.locale = draft.locale;
      row.sort = inLocale.length > 0 ? Math.max(...inLocale.map((p) => p.sort)) + 1 : 0;
      row.updatedAt = ts;
      row.votes = draft.votes;
      return true;
    }
    case 'poll_delete': {
      const id = count(op.target);
      if (id === null) return false;
      const before = snap.polls.length;
      snap.polls = snap.polls.filter((p) => p.id !== id);
      return snap.polls.length !== before;
    }
    case 'poll_reorder':
      return applyReorder(snap.polls, op, (p) => p.locale);
    default:
      // An op type this deployment does not know — a page newer than the server — writes nothing.
      return false;
  }
}

function applyMark(snap: AlbumSnapshot, userId: number, op: Op): boolean {
  if (!op.targetSha) return false;
  const photo = snap.photos.find((p) => p.sha256 === op.targetSha);
  if (!photo) return false;
  const add = op.type === 'like' || op.type === 'dislike' || op.type === 'report';
  const column: MarkColumn =
    op.type === 'like' || op.type === 'unlike'
      ? 'likes'
      : op.type === 'dislike' || op.type === 'undislike'
        ? 'dislikes'
        : 'reports';
  const list = photo[column];
  const has = list.includes(userId);
  if (add && !has) list.push(userId);
  if (!add && has) photo[column] = list.filter((id) => id !== userId);
  // The two attitudes are one choice: adding either clears the other in the same step,
  // a server guarantee rather than a client convention. Reports stand alone.
  const opposite: MarkColumn | undefined =
    add && column === 'likes' ? 'dislikes' : add && column === 'dislikes' ? 'likes' : undefined;
  if (opposite) photo[opposite] = photo[opposite].filter((id) => id !== userId);
  return true;
}

/** Place submitted ids first in their order, keep omitted rows after, renumber 0..n-1 —
 *  the exact semantics the HTTP reorder endpoint owned. */
function applyReorder<T extends { id: number; sort: number; locale: LocaleCode }>(
  rows: T[],
  op: Op,
  localeOf: (row: T) => LocaleCode,
): boolean {
  const body = record(op.payload);
  const locale = isLocaleCode(body.locale) ? body.locale : null;
  const rawIds = body.ids;
  if (!locale || !Array.isArray(rawIds)) return false;
  const ids = [
    ...new Set(
      rawIds.filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return false;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const rest = ids.length;
  const ordered = rows
    .filter((r) => localeOf(r) === locale)
    .sort((a, b) => a.sort - b.sort)
    .sort((a, b) => (rank.get(a.id) ?? rest) - (rank.get(b.id) ?? rest));
  ordered.forEach((row, i) => (row.sort = i));
  return true;
}

interface AnnouncementDraft {
  title: string;
  contentMd: string;
  locale: LocaleCode;
}

/** Announcement text beyond the stored limit. The Durable Object refuses such an op before
 *  the log rather than storing one that can never apply — the client is told and rolls back. */
export function isOversizedAnnouncementOp(op: Op): boolean {
  if (op.type !== 'ann_create' && op.type !== 'ann_update') return false;
  const p = record(op.payload);
  const title = p.title;
  const contentMd = p.contentMd;
  return (
    (typeof title === 'string' && title.length > MAX_TEXT_LENGTH) ||
    (typeof contentMd === 'string' && contentMd.length > MAX_TEXT_LENGTH)
  );
}

function readAnnouncementDraft(p: Record<string, unknown>): AnnouncementDraft | null {
  const title = text(p.title);
  const contentMd = text(p.contentMd);
  const locale = isLocaleCode(p.locale) ? p.locale : null;
  return title && contentMd && locale ? { title, contentMd, locale } : null;
}

interface PollDraft {
  options: string[];
  allowMultiple: boolean;
  locale: LocaleCode;
  votes: Array<{ userId: number; option: number }>;
}

/** A poll draft; `withVotes` reads the complete vote set an overwrite carries. */
function readPollDraft(p: Record<string, unknown>, withVotes: boolean): PollDraft | null {
  const rawOptions = p.options;
  if (!Array.isArray(rawOptions) || rawOptions.length === 0 || rawOptions.length > MAX_POLL_OPTIONS)
    return null;
  const options: string[] = [];
  for (const raw of rawOptions) {
    const option = typeof raw === 'string' ? raw.trim() : '';
    if (!option || option.length > 200) return null;
    options.push(option);
  }
  const locale = isLocaleCode(p.locale) ? p.locale : null;
  if (typeof p.allowMultiple !== 'boolean' || !locale) return null;
  const votes: Array<{ userId: number; option: number }> = [];
  if (withVotes) {
    const rawVotes = p.votes;
    if (!Array.isArray(rawVotes)) return null;
    for (const raw of rawVotes) {
      if (!isRecord(raw)) return null;
      const userId = count(raw.userId);
      const option = count(raw.option);
      if (userId === null || option === null) return null;
      votes.push({ userId, option });
    }
  }
  return { options, allowMultiple: p.allowMultiple, locale, votes };
}

// ---------- D1 hydration and incremental upserts ----------

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

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const list = out.get(key(row));
    if (list) list.push(row);
    else out.set(key(row), [row]);
  }
  return out;
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

/** Read the whole album out of D1 — the cold path (a fresh object, or a snapshot the
 *  object has not built yet). */
export async function hydrateSnapshot(db: Db): Promise<AlbumSnapshot> {
  const [photoRows, annRows, pollRows, reactRows, voteRows, fbRows] = await Promise.all([
    db.prepare('SELECT * FROM photos ORDER BY id ASC').all<PhotoRow>(),
    db.prepare('SELECT * FROM announcements ORDER BY sort ASC').all<AnnRow>(),
    db.prepare('SELECT * FROM polls ORDER BY sort ASC').all<PollRow>(),
    db.prepare('SELECT ann_id, user_id, emoji FROM reactions').all<ReactRow>(),
    db.prepare('SELECT poll_id, user_id, option FROM votes').all<VoteRow>(),
    db.prepare('SELECT * FROM feedback ORDER BY sort ASC').all<FbRow>(),
  ]);
  const reactions = groupBy(reactRows.results, (r) => r.ann_id);
  const votes = groupBy(voteRows.results, (r) => r.poll_id);
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
  const feedback: Feedback[] = fbRows.results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    contentMd: r.content_md,
    createdAt: r.created_at,
    sort: r.sort,
    locale: r.locale,
  }));
  return { photos: photoRows.results.map(rowToPhoto), announcements, polls, feedback };
}

const marksJson = (photo: Photo, column: MarkColumn): string => JSON.stringify(photo[column]);

/** Upsert the rows one applied op touched, or delete them. The snapshot is the source of
 *  a row's full state (marks and votes live inside their owners), so a flush is a
 *  whole-row write keyed by the row's stable id/sha. */
export function statementsForOp(applied: AppliedOp, snap: AlbumSnapshot): DbStatement[] {
  const { op, actor } = applied;
  switch (op.type) {
    case 'upload': {
      const sha = op.targetSha ?? text(record(op.payload).sha256, 128);
      const photo = snap.photos.find((p) => p.sha256 === sha);
      if (!photo) return [];
      return [
        {
          sql: `INSERT INTO photos (id, sha256, url, uploader, width, height, size, created_at, type, likes, dislikes, reports)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (sha256) DO UPDATE SET url=excluded.url, uploader=excluded.uploader,
                  width=excluded.width, height=excluded.height, size=excluded.size,
                  created_at=excluded.created_at, type=excluded.type`,
          binds: [
            photo.id,
            photo.sha256,
            photo.url,
            photo.uploader,
            photo.width,
            photo.height,
            photo.size,
            photo.createdAt,
            photo.type,
            marksJson(photo, 'likes'),
            marksJson(photo, 'dislikes'),
            marksJson(photo, 'reports'),
          ],
        },
      ];
    }
    case 'like':
    case 'unlike':
    case 'dislike':
    case 'undislike':
    case 'report':
    case 'unreport': {
      const photo = snap.photos.find((p) => p.sha256 === op.targetSha);
      if (!photo) return [];
      return [
        {
          sql: 'UPDATE photos SET likes = ?, dislikes = ?, reports = ? WHERE sha256 = ?',
          binds: [
            marksJson(photo, 'likes'),
            marksJson(photo, 'dislikes'),
            marksJson(photo, 'reports'),
            photo.sha256,
          ],
        },
      ];
    }
    case 'delete': {
      if (!op.targetSha) return [];
      return [{ sql: 'DELETE FROM photos WHERE sha256 = ?', binds: [op.targetSha] }];
    }
    case 'fb_create': {
      // The applier pushed exactly one row for this op at `ts`; match on writer + stamp
      // so a replayed op never inserts a second row.
      const fb = snap.feedback.find((f) => f.userId === actor && f.createdAt === applied.ts);
      if (!fb) return [];
      return [
        {
          sql: `INSERT INTO feedback (id, user_id, content_md, created_at, locale, sort)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET content_md=excluded.content_md,
                  created_at=excluded.created_at, sort=excluded.sort`,
          binds: [fb.id, fb.userId, fb.contentMd, fb.createdAt, fb.locale, fb.sort],
        },
      ];
    }
    case 'fb_delete': {
      const id = count(op.target);
      return id === null ? [] : [{ sql: 'DELETE FROM feedback WHERE id = ?', binds: [id] }];
    }
    case 'fb_reorder': {
      const locale = isLocaleCode(record(op.payload).locale) ? record(op.payload).locale : null;
      if (!locale) return [];
      return snap.feedback
        .filter((f) => f.locale === locale)
        .map((f) => ({ sql: 'UPDATE feedback SET sort = ? WHERE id = ?', binds: [f.sort, f.id] }));
    }
    case 'react': {
      const annId = op.target;
      if (annId == null) return [];
      const announcement = snap.announcements.find((a) => a.id === annId);
      if (!announcement) return [];
      const mine = announcement.reactions.filter((r) => r.userId === actor);
      const emoji = mine.length > 0 ? mine[mine.length - 1]!.emoji : null;
      if (emoji === null)
        return [
          { sql: 'DELETE FROM reactions WHERE ann_id = ? AND user_id = ?', binds: [annId, actor] },
        ];
      return [
        {
          sql: `INSERT INTO reactions (ann_id, user_id, emoji) VALUES (?, ?, ?)
                ON CONFLICT (ann_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
          binds: [annId, actor, emoji],
        },
      ];
    }
    case 'ann_create':
    case 'ann_update': {
      const id =
        count(op.target) ??
        (snap.announcements.length > 0 ? Math.max(...snap.announcements.map((a) => a.id)) : 0);
      const row = snap.announcements.find((a) => a.id === id);
      if (!row) return [];
      return [
        {
          sql: `INSERT INTO announcements (id, title, content_md, locale, sort, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET title=excluded.title, content_md=excluded.content_md,
                  locale=excluded.locale, sort=excluded.sort, updated_at=excluded.updated_at`,
          binds: [row.id, row.title, row.contentMd, row.locale, row.sort, row.updatedAt],
        },
      ];
    }
    case 'ann_delete': {
      const id = count(op.target);
      return id === null
        ? []
        : [
            { sql: 'DELETE FROM announcements WHERE id = ?', binds: [id] },
            { sql: 'DELETE FROM reactions WHERE ann_id = ?', binds: [id] },
          ];
    }
    case 'ann_reorder': {
      const locale = isLocaleCode(record(op.payload).locale) ? record(op.payload).locale : null;
      if (!locale) return [];
      return snap.announcements
        .filter((a) => a.locale === locale)
        .map((a) => ({
          sql: 'UPDATE announcements SET sort = ? WHERE id = ?',
          binds: [a.sort, a.id],
        }));
    }
    case 'poll_create':
    case 'poll_update': {
      const id =
        count(op.target) ?? (snap.polls.length > 0 ? Math.max(...snap.polls.map((p) => p.id)) : 0);
      const row = snap.polls.find((p) => p.id === id);
      if (!row) return [];
      return [
        {
          sql: `INSERT INTO polls (id, options, allow_multiple, locale, sort, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET options=excluded.options,
                  allow_multiple=excluded.allow_multiple, locale=excluded.locale,
                  sort=excluded.sort, updated_at=excluded.updated_at`,
          binds: [
            row.id,
            JSON.stringify(row.options),
            row.allowMultiple ? 1 : 0,
            row.locale,
            row.sort,
            row.updatedAt,
          ],
        },
        // A save overwrites the whole vote set (ADR 0022): delete-then-insert in one batch.
        { sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [row.id] },
        ...row.votes.map((vote) => ({
          sql: 'INSERT INTO votes (poll_id, user_id, option) VALUES (?, ?, ?)',
          binds: [row.id, vote.userId, vote.option],
        })),
      ];
    }
    case 'poll_delete': {
      const id = count(op.target);
      return id === null
        ? []
        : [
            { sql: 'DELETE FROM polls WHERE id = ?', binds: [id] },
            { sql: 'DELETE FROM votes WHERE poll_id = ?', binds: [id] },
          ];
    }
    case 'poll_reorder': {
      const locale = isLocaleCode(record(op.payload).locale) ? record(op.payload).locale : null;
      if (!locale) return [];
      return snap.polls
        .filter((p) => p.locale === locale)
        .map((p) => ({ sql: 'UPDATE polls SET sort = ? WHERE id = ?', binds: [p.sort, p.id] }));
    }
    default:
      return [];
  }
}

/** D1's per-query cap on bound parameters is 100; chunk accordingly. */
export const MAX_BATCH_STATEMENTS = 100;

/** Flush applied ops to D1 in bounded transactions. Any failure aborts the archive so the
 *  Durable Object retains its log and can safely retry the idempotent upserts. */
export async function flushToD1(db: Db, snap: AlbumSnapshot, applied: AppliedOp[]): Promise<void> {
  const statements: DbStatement[] = [];
  for (const appliedOp of applied) {
    statements.push(...statementsForOp(appliedOp, snap));
  }
  for (let offset = 0; offset < statements.length; offset += MAX_BATCH_STATEMENTS) {
    const chunk = statements.slice(offset, offset + MAX_BATCH_STATEMENTS);
    await db.batch(chunk);
  }
}
