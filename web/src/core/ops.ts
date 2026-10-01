// Op-log write path and optimistic local application: every write enters the op log,
// syncs, and is corrected by the next full server snapshot. Pure reducers live here so
// they are unit-testable without a browser; the store binds them to reactive state and the engine.

import type {
  Announcement,
  Feedback,
  LocaleCode,
  Op,
  Photo,
  Poll,
  ReactPayload,
  VotePayload,
} from '$shared/types';

/** add/remove `userId` in a JSON mark array; idempotent (contains check first). */
export function toggleId(list: number[], userId: number, add: boolean): number[] {
  const has = list.includes(userId);
  if (add === has) return list; // already in the desired state — no-op
  return add ? [...list, userId] : list.filter((id) => id !== userId);
}

export type MarkKind = 'like' | 'dislike' | 'report';

export const MARK_FIELD: Record<MarkKind, 'likes' | 'dislikes' | 'reports'> = {
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

/** Resolve a photo operation by SHA-256, returning null until the photo exists locally. */
function resolveOpPhoto(photos: Photo[], op: Op): Photo | null {
  if (!op.targetSha) return null;
  return photos.find((p) => p.sha256 === op.targetSha) ?? null;
}

/** Reapply queued marks, reactions, poll votes, and deletions over a snapshot. Upload and feedback rows are managed separately. */
export function reapplyQueued(
  photos: Photo[],
  announcements: Announcement[],
  polls: Poll[],
  queued: Op[],
  selfId: number,
): { photos: Photo[]; announcements: Announcement[]; polls: Poll[] } {
  let p = photos;
  let a = announcements;
  let pollList = polls;
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
          pollList = applyVote(
            pollList,
            op.target,
            selfId,
            (op.payload as VotePayload | null)?.options ?? [],
          );
        break;
      case 'react':
        if (op.target != null)
          a = applyReact(a, op.target, selfId, (op.payload as ReactPayload | null)?.emoji ?? null);
        break;
      default:
        break; // upload / fb_create — see doc comment
    }
  }
  return { photos: p, announcements: a, polls: pollList };
}

/** Optimistically replace one user's selected options for one poll. */
export function applyVote(
  polls: Poll[],
  pollId: number,
  userId: number,
  options: number[],
): Poll[] {
  return polls.map((poll) => {
    if (poll.id !== pollId) return poll;
    const selected = [...new Set(options)].filter(
      (option) => Number.isSafeInteger(option) && option >= 0 && option < poll.options.length,
    );
    const values = poll.allowMultiple ? selected : selected.slice(0, 1);
    const others = poll.votes.filter((vote) => vote.userId !== userId);
    return {
      ...poll,
      votes: [...others, ...values.map((option) => ({ userId, option }))],
    };
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
  locale: LocaleCode,
  now: number,
): Announcement[] {
  const sort =
    anns
      .filter((announcement) => announcement.locale === locale)
      .reduce((max, announcement) => Math.max(max, announcement.sort), -1) + 1;
  return [...anns, { id: tempId, locale, title, contentMd, sort, updatedAt: now, reactions: [] }];
}

export function applyAnnUpdate(
  anns: Announcement[],
  id: number,
  title: string,
  contentMd: string,
  locale: LocaleCode,
  now: number,
): Announcement[] {
  return anns.map((announcement) =>
    announcement.id === id
      ? { ...announcement, locale, title, contentMd, updatedAt: now }
      : announcement,
  );
}

export function applyAnnDelete(anns: Announcement[], id: number): Announcement[] {
  return anns.filter((a) => a.id !== id);
}

/** Order submitted IDs first, preserve omitted rows, and renumber sort values consecutively. */
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
  // The item is already at the target position.
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
  locale: LocaleCode,
  now: number,
): Feedback[] {
  // Same rule as the server's INSERT: one below this locale's minimum → newest on top.
  const localeRows = list.filter((item) => item.locale === locale);
  const minSort = localeRows.reduce((min, item) => Math.min(min, item.sort), 0);
  return [{ id: tempId, userId, locale, contentMd, createdAt: now, sort: minSort - 1 }, ...list];
}

export function applyFbDelete(list: Feedback[], id: number): Feedback[] {
  return list.filter((f) => f.id !== id);
}
