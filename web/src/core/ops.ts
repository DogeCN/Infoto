// Op-log write path + optimistic local application (spec: "设计理念" — all writes
// go through op-log → /sync; "管理面板" — local applies immediately, then syncs).
//
// Pure reducers live here so they are unit-testable without a browser; the store
// (`state/appStore.svelte.ts`) binds them to reactive state and the engine.

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
export function applyMark(photos: Photo[], photoId: number, kind: MarkKind, userId: number, add: boolean): Photo[] {
    const field = MARK_FIELD[kind];
    return photos.map((p) => (p.id === photoId ? { ...p, [field]: toggleId(p[field], userId, add) } : p));
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
    return photos.map((p) => (set.has(p.id) ? { ...p, [field]: toggleId(p[field], userId, add) } : p));
}

/** Optimistically remove photos (root delete). */
export function applyDelete(photos: Photo[], ids: number[]): Photo[] {
    const set = new Set(ids);
    return photos.filter((p) => !set.has(p.id));
}

/** Optimistically set / retract the single vote of `userId` on one announcement. */
export function applyVote(anns: Announcement[], annId: number, userId: number, option: number | null): Announcement[] {
    return anns.map((a) => {
        if (a.id !== annId) return a;
        const others = a.votes.filter((v) => v.userId !== userId);
        return { ...a, votes: option === null ? others : [...others, { userId, option }] };
    });
}

/** Optimistically set / clear one reaction (one emoji per user per announcement). */
export function applyReact(anns: Announcement[], annId: number, userId: number, emoji: string | null): Announcement[] {
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
    return [...anns, { id: tempId, title, contentMd, sort, updatedAt: now, reactions: [], votes: [] }];
}

export function applyAnnUpdate(anns: Announcement[], id: number, title: string, contentMd: string, now: number): Announcement[] {
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

/**
 * Map optimistic temp ids to the real ids the server assigned.
 *
 * Temp ids are negative and descending (-1, -2, …); the server allocates
 * increasing real ids, so newly-appeared announcements sorted ascending
 * correspond to pending temp ids in creation order.
 */
export function resolveTempIds(
    pendingTempIds: number[],
    knownRealIds: Set<number>,
    serverAnns: Announcement[],
): { mapping: Map<number, number>; unresolved: number[] } {
    const fresh = serverAnns
        .filter((a) => !knownRealIds.has(a.id) && a.id > 0)
        .map((a) => a.id)
        .sort((x, y) => x - y);
    const mapping = new Map<number, number>();
    const unresolved: number[] = [];
    pendingTempIds.forEach((tempId, i) => {
        const real = fresh[i];
        if (real === undefined) unresolved.push(tempId);
        else mapping.set(tempId, real);
    });
    return { mapping, unresolved };
}

/** Rewrite op targets that referenced optimistic temp ids. */
export function remapOpTarget(op: Op, mapping: Map<number, number>): Op {
    if (op.target == null || op.target >= 0) return op;
    const real = mapping.get(op.target);
    return real === undefined ? op : { ...op, target: real };
}

/** Feedback list helpers (root only sees real rows; others are optimistic-only). */
export function applyFbCreate(list: Feedback[], tempId: number, userId: number, contentMd: string, now: number): Feedback[] {
    return [{ id: tempId, userId, contentMd, createdAt: now }, ...list];
}

export function applyFbDelete(list: Feedback[], id: number): Feedback[] {
    return list.filter((f) => f.id !== id);
}
