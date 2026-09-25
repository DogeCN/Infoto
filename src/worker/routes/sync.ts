// POST /sync — the single write entry point (spec: "/sync protocol").
// Applies every op in array order, then returns the full state snapshot.
// Non-root admin ops are silently dropped; malformed ops never break the batch.

import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import type { Db } from '../db.ts';
import type { Announcement, Feedback, Op, Photo, SyncRequest } from '../../shared/types.ts';
import { ROOT_ID, createUser, resolveUser, sessionCookie, type UserRow } from '../identity.ts';
import { verifyTurnstile } from '../turnstile.ts';

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
  sort: number;
  updated_at: number;
}
interface FbRow {
  id: number;
  user_id: number;
  content_md: string;
  created_at: number;
}
interface ReactRow {
  ann_id: number;
  user_id: number;
  emoji: string;
}
interface VoteRow {
  ann_id: number;
  user_id: number;
  option: number;
}

const idList = (json: string): number[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

const rec = (p: Op['payload']): Record<string, unknown> =>
  p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

type MarkCol = 'likes' | 'dislikes' | 'reports';

async function toggleMark(
  db: Db,
  photoId: number | null,
  userId: number,
  col: MarkCol,
  add: boolean,
): Promise<void> {
  if (photoId === null) return;
  const row = await db
    .prepare('SELECT id, likes, dislikes, reports FROM photos WHERE id = ?')
    .bind(photoId)
    .first<PhotoRow>();
  if (!row) return;
  const list = idList(row[col]);
  const has = list.includes(userId);
  if (add === has) return;
  if (add) list.push(userId);
  else list.splice(list.indexOf(userId), 1);
  await db
    .prepare(`UPDATE photos SET ${col} = ? WHERE id = ?`)
    .bind(JSON.stringify(list), photoId)
    .run();
}

async function applyOp(db: Db, user: UserRow, op: Op, serverTime: number): Promise<void> {
  const isRoot = user.id === ROOT_ID;
  try {
    switch (op.type) {
      case 'upload': {
        const p = rec(op.payload);
        const sha256 = str(p.sha256);
        const url = str(p.url);
        const width = num(p.width);
        const height = num(p.height);
        const size = num(p.size);
        const type = num(p.type);
        if (!sha256 || !url || width === null || height === null || size === null) return;
        if (type !== 0 && type !== 1 && type !== 2) return;
        const dup = await db.prepare('SELECT id FROM photos WHERE sha256 = ?').bind(sha256).first();
        if (dup) return;
        await db
          .prepare(
            'INSERT INTO photos (sha256, url, uploader, width, height, size, created_at, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(sha256, url, user.id, width, height, size, serverTime, type)
          .run();
        return;
      }
      case 'like':
        return toggleMark(db, op.target ?? null, user.id, 'likes', true);
      case 'unlike':
        return toggleMark(db, op.target ?? null, user.id, 'likes', false);
      case 'dislike':
        return toggleMark(db, op.target ?? null, user.id, 'dislikes', true);
      case 'undislike':
        return toggleMark(db, op.target ?? null, user.id, 'dislikes', false);
      case 'report':
        return toggleMark(db, op.target ?? null, user.id, 'reports', true);
      case 'unreport':
        return toggleMark(db, op.target ?? null, user.id, 'reports', false);
      case 'delete': {
        if (!isRoot || op.target == null) return;
        await db.prepare('DELETE FROM photos WHERE id = ?').bind(op.target).run();
        return;
      }
      case 'fb_create': {
        const p = rec(op.payload);
        const contentMd = str(p.contentMd);
        if (!contentMd) return;
        await db
          .prepare('INSERT INTO feedback (user_id, content_md, created_at) VALUES (?, ?, ?)')
          .bind(user.id, contentMd, serverTime)
          .run();
        return;
      }
      case 'fb_delete': {
        if (!isRoot || op.target == null) return;
        await db.prepare('DELETE FROM feedback WHERE id = ?').bind(op.target).run();
        return;
      }
      case 'react': {
        if (op.target == null) return;
        const ann = await db
          .prepare('SELECT id FROM announcements WHERE id = ?')
          .bind(op.target)
          .first();
        if (!ann) return;
        const emoji = str(rec(op.payload).emoji);
        if (emoji) {
          await db
            .prepare('INSERT OR REPLACE INTO reactions (ann_id, user_id, emoji) VALUES (?, ?, ?)')
            .bind(op.target, user.id, emoji)
            .run();
        } else {
          await db
            .prepare('DELETE FROM reactions WHERE ann_id = ? AND user_id = ?')
            .bind(op.target, user.id)
            .run();
        }
        return;
      }
      case 'vote': {
        if (op.target == null) return;
        // the announcement must exist (no orphan rows); one row per user,
        // overwritten on every re-vote, deleted when option is null
        const ann = await db
          .prepare('SELECT id FROM announcements WHERE id = ?')
          .bind(op.target)
          .first();
        if (!ann) return;
        const raw = rec(op.payload).option;
        const option = raw === null ? null : num(raw);
        if (raw !== null && (option === null || option < 0 || !Number.isInteger(option))) return;
        if (option === null) {
          await db
            .prepare('DELETE FROM votes WHERE ann_id = ? AND user_id = ?')
            .bind(op.target, user.id)
            .run();
        } else {
          await db
            .prepare('INSERT OR REPLACE INTO votes (ann_id, user_id, option) VALUES (?, ?, ?)')
            .bind(op.target, user.id, option)
            .run();
        }
        return;
      }
      default:
        return;
    }
  } catch {
    // A broken op must never break its batch — drop it silently.
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
  type: (r.type === 1 || r.type === 2 ? r.type : 0) as Photo['type'],
  likes: idList(r.likes),
  dislikes: idList(r.dislikes),
  reports: idList(r.reports),
});

async function snapshot(
  db: Db,
  selfId: number,
): Promise<{
  photos: Photo[];
  announcements: Announcement[];
  feedback: Feedback[];
}> {
  const [photoRows, annRows, reactRows, voteRows] = await Promise.all([
    db.prepare('SELECT * FROM photos ORDER BY id ASC').all<PhotoRow>(),
    db.prepare('SELECT * FROM announcements ORDER BY sort ASC, id ASC').all<AnnRow>(),
    db.prepare('SELECT ann_id, user_id, emoji FROM reactions').all<ReactRow>(),
    db.prepare('SELECT ann_id, user_id, option FROM votes').all<VoteRow>(),
  ]);
  const byAnn = new Map<number, Array<{ userId: number; emoji: string }>>();
  for (const r of reactRows.results) {
    const list = byAnn.get(r.ann_id) ?? [];
    list.push({ userId: r.user_id, emoji: r.emoji });
    byAnn.set(r.ann_id, list);
  }
  const votesByAnn = new Map<number, Array<{ userId: number; option: number }>>();
  for (const r of voteRows.results) {
    const list = votesByAnn.get(r.ann_id) ?? [];
    list.push({ userId: r.user_id, option: r.option });
    votesByAnn.set(r.ann_id, list);
  }
  const photos = photoRows.results.map(rowToPhoto);
  const announcements: Announcement[] = annRows.results.map((r) => ({
    id: r.id,
    title: r.title,
    contentMd: r.content_md,
    sort: r.sort,
    updatedAt: r.updated_at,
    reactions: byAnn.get(r.id) ?? [],
    votes: votesByAnn.get(r.id) ?? [],
  }));
  let feedback: Feedback[] = [];
  if (selfId === ROOT_ID) {
    const fb = await db
      .prepare('SELECT * FROM feedback ORDER BY created_at DESC, id DESC')
      .all<FbRow>();
    feedback = fb.results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      contentMd: r.content_md,
      createdAt: r.created_at,
    }));
  }
  return { photos, announcements, feedback };
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

    let user = await resolveUser(env.db, c.req.header('cookie'));
    if (!user) {
      // first entry: tokenless /sync only hands out the site key; the token
      // rides exactly one follow-up /sync (spec "Identity & Cookie")
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
    for (const op of body.ops) {
      await applyOp(env.db, user, op, serverTime);
    }

    const snap = await snapshot(env.db, user.id);
    const res = c.json({ ok: true, serverTime, selfId: user.id, ...snap });
    res.headers.set('Set-Cookie', sessionCookie(user.uuid, c.req.raw));
    return res;
  };
}
