// Op-log write path and optimistic local application: every write enters the op log,
// syncs, and is corrected by the next full server snapshot. Pure reducers live here so
// they are unit-testable without a browser; the store binds them to reactive state and the engine.

import type { Announcement, Feedback, Op, Photo } from '$shared/types';

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

/** Reorder to the given id sequence; sort renormalized to 0…n-1 (server does the same). */
export function applyAnnReorder(anns: Announcement[], orderedIds: number[]): Announcement[] {
  const map = new Map(anns.map((a) => [a.id, a]));
  const ordered: Announcement[] = [];
  for (const id of orderedIds) {
    const a = map.get(id);
    if (a) {
      ordered.push(a);
      map.delete(id);
    }
  }
  // anything not mentioned keeps its relative order at the end
  for (const a of anns) if (map.has(a.id)) ordered.push(a);
  return ordered.map((a, i) => ({ ...a, sort: i }));
}

export interface AnnouncementReorderDraft {
  sourceIds: number[];
  orderedIds: number[];
  dragId: number | null;
  finalized: boolean;
}

export function beginAnnouncementReorder(ids: number[], dragId: number): AnnouncementReorderDraft {
  return { sourceIds: [...ids], orderedIds: [...ids], dragId, finalized: false };
}

/** Move the dragged id so it lands at insertion slot `slot` (0…n, positions in final order). */
export function moveAnnouncementReorderToIndex(
  draft: AnnouncementReorderDraft,
  slot: number,
): AnnouncementReorderDraft {
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

export function finalizeAnnouncementReorder(draft: AnnouncementReorderDraft): {
  draft: AnnouncementReorderDraft;
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

export function cancelAnnouncementReorder(
  draft: AnnouncementReorderDraft,
): AnnouncementReorderDraft {
  return { ...draft, dragId: null, finalized: true };
}

export function rollbackAnnouncementOrder(
  anns: Announcement[],
  previousIds: number[],
): Announcement[] {
  return applyAnnReorder(anns, previousIds);
}

/** Rewrite op targets that referenced optimistic temp ids. */
export function remapOpTarget(op: Op, mapping: ReadonlyMap<number, number>): Op {
  if (op.target == null || op.target >= 0) return op;
  const real = mapping.get(op.target);
  return real === undefined ? op : { ...op, target: real };
}

/** Feedback list helpers (root only sees real rows; others are optimistic-only). */
export function applyFbCreate(
  list: Feedback[],
  tempId: number,
  userId: number,
  contentMd: string,
  now: number,
): Feedback[] {
  return [{ id: tempId, userId, contentMd, createdAt: now }, ...list];
}

export function applyFbDelete(list: Feedback[], id: number): Feedback[] {
  return list.filter((f) => f.id !== id);
}
