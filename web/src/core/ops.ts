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

export interface MarkOpSpec {
  kind: MarkKind;
  /** Adding the mark (true) or removing it (false). */
  add: boolean;
}

const MARK_KINDS: MarkKind[] = ['like', 'dislike', 'report'];

/**
 * Every mark op in one table, derived from the kind and the `un` prefix rather than written out
 * six times. The fold (`reapplyQueued`), the log's supersede rule (`coalesceKey`) and the store's
 * op construction all read this mapping, so a new kind cannot be wired into one of them and
 * forgotten in another.
 */
export const MARK_OPS: Record<string, MarkOpSpec> = Object.fromEntries(
  MARK_KINDS.flatMap((kind) => [
    [kind, { kind, add: true }],
    [`un${kind}`, { kind, add: false }],
  ]),
);

/** Op type for adding / removing a mark. */
export function markOpType(kind: MarkKind, add: boolean): Op['type'] {
  return add ? kind : (`un${kind}` as Op['type']);
}

/** The mark an op applies, or undefined for every other op kind. */
export function markOpSpec(type: Op['type']): MarkOpSpec | undefined {
  return MARK_OPS[type];
}

/** The mark a photo's opposite writes: a like and a dislike are one choice, never both. */
const OPPOSITE_KIND: Partial<Record<MarkKind, MarkKind>> = { like: 'dislike', dislike: 'like' };

/** The three mark columns of one photo. */
export type MarkSet = { likes: number[]; dislikes: number[]; reports: number[] };

/** The all-empty mark columns, shared by every caller that has no marks yet. The pending-card
 *  projection compares mark sets by reference, so a fresh `{ likes: [], … }` per lookup would
 *  make every recompute look like a change. Never mutate the returned object. */
export const EMPTY_MARKS: MarkSet = { likes: [], dislikes: [], reports: [] };

/**
 * Apply one mark to a photo's mark columns, mirroring the server: adding a like or a dislike
 * also clears the other column, because the two are one choice. The server enforces that in
 * the same statement it writes the mark, so a client that folded only the column it named
 * would disagree with the snapshot it is about to receive. Reports stand alone.
 */
export function applyMarkToSet(
  set: MarkSet,
  kind: MarkKind,
  userId: number,
  add: boolean,
): MarkSet {
  const field = MARK_FIELD[kind];
  const next = { ...set, [field]: toggleId(set[field], userId, add) };
  const opposite = add ? OPPOSITE_KIND[kind] : undefined;
  if (!opposite) return next;
  const other = MARK_FIELD[opposite];
  return { ...next, [other]: toggleId(next[other], userId, false) };
}

/**
 * The dimension an op writes, used to supersede a queued op of the same dimension — null for
 * ops that must keep their place in the log.
 *
 * The server's marks, votes and reactions are all last-write-wins per dimension: `setMark` is
 * a set add/remove that also clears the opposite attitude, `vote` replaces the voter's whole
 * option set, `react` is an upsert. Two queued ops on one dimension therefore collapse to the
 * newest without changing the outcome — a like and a dislike share one key precisely because
 * the server clears the opposite column when either is added, so the newest op states the
 * whole intent. A report is a separate dimension and may coexist with either.
 *
 * `upload`, `delete` and `fb_create` return null: they are ordered (a mark must follow its
 * upload), terminal, or append-only.
 */
export function coalesceKey(op: Op): string | null {
  const mark = markOpSpec(op.type);
  if (mark) {
    return op.targetSha
      ? `${mark.kind === 'report' ? 'report' : 'attitude'}:${op.targetSha}`
      : null;
  }
  if (op.type === 'vote') return op.target != null ? `vote:${op.target}` : null;
  if (op.type === 'react') return op.target != null ? `react:${op.target}` : null;
  return null;
}

/** Optimistically apply a mark to one photo or a selection. */
function applyMarks(
  photos: Photo[],
  ids: Iterable<number>,
  kind: MarkKind,
  userId: number,
  add: boolean,
): Photo[] {
  const set = ids instanceof Set ? ids : new Set(ids);
  return photos.map((p) => (set.has(p.id) ? { ...p, ...applyMarkToSet(p, kind, userId, add) } : p));
}

/** Optimistically apply a mark to one photo. */
export function applyMark(
  photos: Photo[],
  photoId: number,
  kind: MarkKind,
  userId: number,
  add: boolean,
): Photo[] {
  return applyMarks(photos, [photoId], kind, userId, add);
}

/** Optimistically apply a mark to many photos (multi-select). */
export function applyMarkMany(
  photos: Photo[],
  ids: number[],
  kind: MarkKind,
  userId: number,
  add: boolean,
): Photo[] {
  return applyMarks(photos, ids, kind, userId, add);
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
  let pollRows = polls;
  for (const op of queued) {
    const mark = markOpSpec(op.type);
    if (mark) {
      const photo = resolveOpPhoto(p, op);
      if (photo) p = applyMark(p, photo.id, mark.kind, selfId, mark.add);
      continue;
    }
    switch (op.type) {
      case 'delete': {
        const photo = resolveOpPhoto(p, op);
        if (photo) p = applyDelete(p, [photo.id]);
        break;
      }
      case 'vote':
        if (op.target != null)
          pollRows = applyVote(
            pollRows,
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
  return { photos: p, announcements: a, polls: pollRows };
}

/** Optimistically replace one user's selected options for a poll. */
export function applyVote(
  polls: Poll[],
  pollId: number,
  userId: number,
  options: number[],
): Poll[] {
  return polls.map((poll) => {
    if (poll.id !== pollId) return poll;
    const others = poll.votes.filter((vote) => vote.userId !== userId);
    return {
      ...poll,
      votes: [...others, ...options.map((option) => ({ userId, option }))],
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
  const sort = anns.reduce((m, a) => Math.max(m, a.sort), -1) + 1;
  return [...anns, { id: tempId, title, contentMd, locale, sort, updatedAt: now, reactions: [] }];
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

export function applyPollCreate(
  polls: Poll[],
  tempId: number,
  options: string[],
  allowMultiple: boolean,
  locale: LocaleCode,
  now: number,
): Poll[] {
  const sort = polls.reduce((max, poll) => Math.max(max, poll.sort), -1) + 1;
  return [
    ...polls,
    { id: tempId, options, allowMultiple, locale, sort, updatedAt: now, votes: [] },
  ];
}

/**
 * Apply a poll edit, keeping the votes unless the edit asks a different question.
 *
 * A vote addresses its option by index, and the editor keeps the options in order, so a same
 * length list means the same indices — editing an option's text keeps everyone's vote. Adding or
 * removing an option, or switching the choice mode, invalidates the indices or changes what the
 * question means, and clears them. Client and server must agree exactly: a row the optimistic
 * update kept and the server dropped shows a count the next snapshot contradicts.
 */
export function applyPollUpdate(
  polls: Poll[],
  id: number,
  options: string[],
  allowMultiple: boolean,
  now: number,
): Poll[] {
  return polls.map((poll) => {
    if (poll.id !== id) return poll;
    const definitionChanged =
      allowMultiple !== poll.allowMultiple || options.length !== poll.options.length;
    return {
      ...poll,
      options,
      allowMultiple,
      updatedAt: now,
      votes: definitionChanged ? [] : poll.votes,
    };
  });
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
  // Same rule as the server's INSERT: one below the current minimum → newest on top.
  const minSort = list.reduce((min, item) => Math.min(min, item.sort), 0);
  return [{ id: tempId, userId, contentMd, createdAt: now, locale, sort: minSort - 1 }, ...list];
}
