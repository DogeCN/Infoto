// Op-log write path and optimistic local application: every write enters the op log,
// syncs, and is corrected by the next full server snapshot. Pure reducers live here so
// they are unit-testable without a browser; the store binds them to reactive state and the engine.

import type { Announcement, Feedback, Op, Photo, ReactPayload, VotePayload } from '$shared/types';

/** add/remove `userId` in a JSON mark array; idempotent (contains check first). */
export function toggleId(list: number[], userId: number, add: boolean): number[] {
  const has = list.includes(userId);
  if (add === has) return list; // already in the desired state — no-op
  return add ? [...list, userId] : list.filter((id) => id !== userId);
}

export type MarkKind = 'like' | 'dislike' | 'report';

const MARK_FIELD: Record<MarkKind, 'likes' | 'dislikes' | 'reports'> = {
  like: 'likes',
  dislike: 'dislikes',
  report: 'reports',
};

/** Op type for adding / removing a mark. */
export function markOpType(kind: MarkKind, add: boolean): Op['type'] {
  if (kind === 'like') return add ? 'like' : 'unlike';
  if (kind === 'dislike') return add ? 'dislike' : 'undislike';
  return add ? 'report' : 'unreport';
}

/** Optimistically apply a mark to one photo. */
export function applyMark(
  photos: Photo[],
  photoId: number,
  kind: MarkKind,
  userId: number,
  add: boolean,
): Photo[] {
  const field = MARK_FIELD[kind];
  return photos.map((p) =>
    p.id === photoId ? { ...p, [field]: toggleId(p[field], userId, add) } : p,
  );
}

/** Optimistically apply a mark to many photos (multi-select). */
export function applyMarkMany(
  photos: Photo[],
  ids: number[],
  kind: MarkKind,
  userId: number,
  add: boolean,
): Photo[] {
  const set = new Set(ids);
  const field = MARK_FIELD[kind];
  return photos.map((p) =>
    set.has(p.id) ? { ...p, [field]: toggleId(p[field], userId, add) } : p,
  );
}

/** Optimistically remove photos (root delete). */
export function applyDelete(photos: Photo[], ids: number[]): Photo[] {
  const set = new Set(ids);
  return photos.filter((p) => !set.has(p.id));
}

/**
 * The photo an op targets, as it exists in `photos`. Photo ops are addressed by sha256 —
 * the stable unique index — so this resolves a mark written while its photo was still
 * uploading as soon as the row lands. Returns null when the photo is not in the list.
 */
export function resolveOpPhoto(photos: Photo[], op: Op): Photo | null {
  if (!op.targetSha) return null;
  return photos.find((p) => p.sha256 === op.targetSha) ?? null;
}

/** Re-fold ops still queued in the local oplog onto a fresh server snapshot: a snapshot
 * computed before they reached the server must not revert optimistic state (the reducers
 * are idempotent). `upload`/`fb_create` rows are managed outside this fold; feedback is snapshot-authoritative. */
export function reapplyQueued(
  photos: Photo[],
  announcements: Announcement[],
  queued: Op[],
  selfId: number,
): { photos: Photo[]; announcements: Announcement[] } {
  let p = photos;
  let a = announcements;
  for (const op of queued) {
    const photo = resolveOpPhoto(p, op);
    switch (op.type) {
      case 'like':
      case 'unlike':
      case 'dislike':
      case 'undislike':
      case 'report':
      case 'unreport': {
        if (!photo) break;
        const kind: MarkKind =
          op.type === 'like' || op.type === 'unlike'
            ? 'like'
            : op.type === 'dislike' || op.type === 'undislike'
              ? 'dislike'
              : 'report';
        p = applyMark(p, photo.id, kind, selfId, !op.type.startsWith('un'));
        break;
      }
      case 'delete':
        if (photo) p = applyDelete(p, [photo.id]);
        break;
      case 'vote':
        if (op.target != null)
          a = applyVote(a, op.target, selfId, (op.payload as VotePayload | null)?.option ?? null);
        break;
      case 'react':
        if (op.target != null)
          a = applyReact(a, op.target, selfId, (op.payload as ReactPayload | null)?.emoji ?? null);
        break;
      default:
        break; // upload / fb_create — see doc comment
    }
  }
  return { photos: p, announcements: a };
}

/** Optimistically set / retract the single vote of `userId` on one announcement. */
export function applyVote(
  anns: Announcement[],
  annId: number,
  userId: number,
  option: number | null,
): Announcement[] {
  return anns.map((a) => {
    if (a.id !== annId) return a;
    const others = a.votes.filter((v) => v.userId !== userId);
    return { ...a, votes: option === null ? others : [...others, { userId, option }] };
  });
}

/** Optimistically set / clear one reaction (one emoji per user per announcement). */
export function applyReact(
  anns: Announcement[],
  annId: number,
  userId: number,
  emoji: string | null,
): Announcement[] {
  return anns.map((a) => {
    if (a.id !== annId) return a;
    const others = a.reactions.filter((r) => r.userId !== userId);
    return { ...a, reactions: emoji ? [...others, { userId, emoji }] : others };
  });
}

/** Append an optimistically-created announcement (negative temp id). */
export function applyAnnCreate(
  anns: Announcement[],
  tempId: number,
  title: string,
  contentMd: string,
  now: number,
): Announcement[] {
  const sort = anns.reduce((m, a) => Math.max(m, a.sort), -1) + 1;
  return [
    ...anns,
    { id: tempId, title, contentMd, sort, updatedAt: now, reactions: [], votes: [] },
  ];
}

export function applyAnnUpdate(
  anns: Announcement[],
  id: number,
  title: string,
  contentMd: string,
  now: number,
): Announcement[] {
  return anns.map((a) => (a.id === id ? { ...a, title, contentMd, updatedAt: now } : a));
}

export function applyAnnDelete(anns: Announcement[], id: number): Announcement[] {
  return anns.filter((a) => a.id !== id);
}

/** Reorder `list` to follow `orderedIds` and renumber `sort` to 0…n-1 (the server
 * assigns the same numbers). Ids not mentioned keep their relative order at the
 * end, so a reorder from a filtered/dragged subset never drops rows. */
export function applyReorder<T extends { id: number; sort: number }>(
  list: readonly T[],
  orderedIds: readonly number[],
): T[] {
  const map = new Map(list.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of orderedIds) {
    const item = map.get(id);
    if (item) {
      ordered.push(item);
      map.delete(id);
    }
  }
  // anything not mentioned keeps its relative order at the end
  for (const item of list) if (map.has(item.id)) ordered.push(item);
  return ordered.map((item, index) => ({ ...item, sort: index }));
}

export interface ReorderDraft {
  sourceIds: number[];
  orderedIds: number[];
  dragId: number | null;
  finalized: boolean;
}

export function beginReorder(ids: readonly number[], dragId: number): ReorderDraft {
  return { sourceIds: [...ids], orderedIds: [...ids], dragId, finalized: false };
}

/** Move the dragged id so it lands at insertion slot `slot` (0…n, positions in final order). */
export function moveReorderToIndex(draft: ReorderDraft, slot: number): ReorderDraft {
  if (draft.finalized || draft.dragId === null) return draft;
  const from = draft.orderedIds.indexOf(draft.dragId);
  if (from < 0) return draft;
  const clamped = Math.max(0, Math.min(slot, draft.orderedIds.length));
  // already there (or would land right back where it was)
  if (clamped === from || clamped === from + 1) return draft;
  const orderedIds = [...draft.orderedIds];
  const [id] = orderedIds.splice(from, 1);
  if (id === undefined) return draft;
  orderedIds.splice(clamped > from ? clamped - 1 : clamped, 0, id);
  return { ...draft, orderedIds };
}

export function finalizeReorder(draft: ReorderDraft): {
  draft: ReorderDraft;
  /** New order when it actually changed, else null (nothing to send). */
  orderedIds: number[] | null;
} {
  if (draft.finalized) return { draft, orderedIds: null };
  const finalized = { ...draft, dragId: null, finalized: true };
  if (draft.orderedIds.every((id, index) => id === draft.sourceIds[index])) {
    return { draft: finalized, orderedIds: null };
  }
  return { draft: finalized, orderedIds: [...draft.orderedIds] };
}

/** Feedback list helpers (root only sees real rows; others are optimistic-only). */
export function applyFbCreate(
  list: Feedback[],
  tempId: number,
  userId: number,
  contentMd: string,
  now: number,
): Feedback[] {
  // Same rule as the server's INSERT: one below the current minimum → newest on top.
  const minSort = list.reduce((min, item) => Math.min(min, item.sort), 0);
  return [{ id: tempId, userId, contentMd, createdAt: now, sort: minSort - 1 }, ...list];
}

export function applyFbDelete(list: Feedback[], id: number): Feedback[] {
  return list.filter((f) => f.id !== id);
}
