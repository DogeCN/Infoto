// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to reactive
// state. Every write goes op-log → /sync: mutate local state optimistically, append the
// op, let the engine submit.

import type { Announcement, Feedback, Op, Photo, SyncResponse } from '$shared/types';
import { copy } from '$shared/copy';
import type { EngineState, SyncEngine, SyncSnapshotContext } from '../core/engine';
import { toast } from 'svelte-sonner';
import * as ops from '../core/ops';
import {
  ANN_TIMEOUT,
  FB_TIMEOUT,
  createAnnouncement,
  deleteAnnouncement,
  deleteFeedback,
  reorderAnnouncements,
  reorderFeedback,
  updateAnnouncement,
} from '../core/api/adminClient';

/** Allocate descending temporary IDs for optimistic announcements and feedback. */
let nextTempId = -1;
const takeTempId = (): number => nextTempId--;

/** Failure hint for an admin write: a stalled request carries a stable timeout id,
 * so the toast can tell "backend not responding" from a plain network error. */
function adminFailHint(error: unknown, timeoutId: string): string {
  return error instanceof Error && error.message === timeoutId
    ? copy.admin.fail.backendTimeout
    : copy.admin.fail.network;
}

/** Cache the public self ID for initial rendering; authenticated snapshots replace it. */
const SELF_ID_KEY = 'infoto-self-id';
const PENDING_MARKS_KEY = 'infoto-pending-marks';

function readCachedSelfId(): number {
  try {
    const raw = localStorage.getItem(SELF_ID_KEY);
    // Number('') === 0: an empty/whitespace value must not read as root (id 0).
    if (raw !== null && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) return n;
    }
  } catch {
    /* noop */
  }
  return -1;
}

function readCachedPendingMarks(): Map<
  string,
  { likes: number[]; dislikes: number[]; reports: number[] }
> {
  try {
    const raw = localStorage.getItem(PENDING_MARKS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as [
        string,
        { likes: number[]; dislikes: number[]; reports: number[] },
      ][];
      return new Map(parsed);
    }
  } catch {
    /* noop */
  }
  return new Map();
}

function writePendingMarks(
  marks: Map<string, { likes: number[]; dislikes: number[]; reports: number[] }>,
): void {
  try {
    localStorage.setItem(PENDING_MARKS_KEY, JSON.stringify([...marks.entries()]));
  } catch {
    /* storage blocked */
  }
}

class AppState {
  engineState = $state<EngineState>({ syncing: false, pending: 0 });
  selfId = $state<number>(readCachedSelfId());
  photos = $state<Photo[]>([]);
  announcements = $state<Announcement[]>([]);
  feedback = $state<Feedback[]>([]);

  private tempIdMap = new Map<number, number>();
  private pendingReorder: { ids: number[]; previousIds: number[] } | null = null;
  private engineUnsubscribe: (() => void) | null = null;

  /** Optimistic marks on photos whose row does not exist server-side yet, keyed by sha256
   *  (the same address photo ops use). Merged into the pending cards so they highlight. */
  pendingMarks =
    $state<Map<string, { likes: number[]; dislikes: number[]; reports: number[] }>>(
      readCachedPendingMarks(),
    );

  private engine: SyncEngine | null = null;

  /** Replace the engine subscription when binding a different engine. */
  bindEngine(engine: SyncEngine): void {
    if (this.engine === engine) return;
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = null;
    this.engine = engine;
    this.engineState = { ...engine.state };
    this.engineUnsubscribe = engine.onState((state) => {
      this.engineState = { ...state };
    });
  }

  dispose(): void {
    this.engineUnsubscribe?.();
    this.engineUnsubscribe = null;
    this.engine = null;
  }

  private submit(op: Op): Promise<number | null> {
    if (!this.engine) return Promise.resolve(null);
    // Report storage failures without an unhandled rejection.
    return this.engine.addOp(op).catch((e) => {
      console.error('[op] append failed', e);
      toast.error(copy.sync.failed, { description: copy.sync.storageFailed });
      return null;
    });
  }

  /** Apply one authoritative full snapshot. */
  applySync(r: SyncResponse, context?: SyncSnapshotContext): void {
    this.selfId = r.selfId;
    try {
      localStorage.setItem(SELF_ID_KEY, String(r.selfId));
    } catch {
      /* storage blocked */
    }
    // A snapshot computed before our just-appended ops reached the server must not
    // revert the optimistic state: re-fold every op still queued in the oplog.
    const refolded = ops.reapplyQueued(
      r.photos,
      r.announcements,
      context?.queuedOps ?? [],
      r.selfId,
    );
    this.photos = refolded.photos;

    // Keep pending creates alongside authoritative announcements until completion or rollback.
    const unconfirmed = this.announcements.filter((announcement) => announcement.id < 0);
    this.announcements = [...refolded.announcements, ...unconfirmed].sort(
      (a, b) => a.sort - b.sort || a.id - b.id,
    );

    // Feedback has no foldable op left (deletes go through /admin/feedback), so the
    // snapshot is authoritative for root; non-root visitors never receive rows.
    this.feedback = r.selfId === 0 ? r.feedback : [];
  }

  // Photos

  private submitPhotoOp(sha256: string, op: Op): void {
    if (!sha256) return;
    void this.submit({ ...op, targetSha: sha256 });
  }

  /** A pending card is gone for good (cancelled / failed / dismissed): drop its state. */
  forgetPendingPhoto(sha256: string): void {
    if (!sha256) return;
    if (!this.pendingMarks.has(sha256)) return;
    const marks = new Map(this.pendingMarks);
    marks.delete(sha256);
    this.pendingMarks = marks;
    writePendingMarks(marks);
  }

  /** Optimistic root delete without confirmation. */
  private removePhotos(ids: number[]): void {
    this.photos = ops.applyDelete(this.photos, ids);
  }

  /** Marks of a pending card, merged into its render model. */
  pendingMarksFor(sha256: string): { likes: number[]; dislikes: number[]; reports: number[] } {
    return this.pendingMarks.get(sha256) ?? { likes: [], dislikes: [], reports: [] };
  }

  /** Apply one mark to a pending card and replace the map entry. */
  private setPendingMark(sha256: string, kind: ops.MarkKind, add: boolean): void {
    const field = ops.MARK_FIELD[kind];
    const cur = this.pendingMarks.get(sha256) ?? { likes: [], dislikes: [], reports: [] };
    const marks = new Map(this.pendingMarks);
    marks.set(sha256, { ...cur, [field]: ops.toggleId(cur[field], this.selfId, add) });
    this.pendingMarks = marks;
    writePendingMarks(marks);
  }

  /** Apply one mark locally (pending card or snapshot row) and queue its op. */
  setMarkBySha(sha256: string, kind: ops.MarkKind, add: boolean): void {
    if (this.selfId < 0 || !sha256) return;
    const row = this.photos.find((p) => p.sha256 === sha256);
    if (row) {
      this.photos = ops.applyMark(this.photos, row.id, kind, this.selfId, add);
    } else {
      this.setPendingMark(sha256, kind, add);
    }
    this.submitPhotoOp(sha256, { type: ops.markOpType(kind, add) });
  }

  /** Toggle one mark; likes and dislikes remain mutually exclusive. */
  toggleMark(sha256: string, kind: ops.MarkKind): void {
    const p = this.photos.find((x) => x.sha256 === sha256);
    const field = ops.MARK_FIELD[kind];
    const has = p
      ? p[field].includes(this.selfId)
      : (this.pendingMarks.get(sha256)?.[field] ?? []).includes(this.selfId);
    if (!has && kind !== 'report') {
      // One photo can carry either like or dislike, never both.
      const other = kind === 'like' ? 'dislikes' : 'likes';
      const otherKind: ops.MarkKind = kind === 'like' ? 'dislike' : 'like';
      const hasOther = p
        ? p[other].includes(this.selfId)
        : (this.pendingMarks.get(sha256)?.[other] ?? []).includes(this.selfId);
      if (hasOther) this.setMarkBySha(sha256, otherKind, false);
    }
    this.setMarkBySha(sha256, kind, !has);
  }

  setMarkMany(shas: string[], kind: ops.MarkKind, add: boolean): void {
    if (this.selfId < 0) return;
    const unique = [...new Set(shas)];
    const real = unique.filter((sha) => this.photos.some((p) => p.sha256 === sha));
    const pending = unique.filter((sha) => !real.includes(sha));
    if (real.length > 0) {
      const ids = real
        .map((sha) => this.photos.find((p) => p.sha256 === sha)?.id)
        .filter((id): id is number => id !== undefined);
      this.photos = ops.applyMarkMany(this.photos, ids, kind, this.selfId, add);
    }
    for (const sha of pending) this.setPendingMark(sha, kind, add);
    for (const sha of unique) this.submitPhotoOp(sha, { type: ops.markOpType(kind, add) });
  }

  /** Optimistic root delete for multi-selection (sha-addressed, pending cards included). */
  deletePhotos(shas: string[]): void {
    if (this.selfId !== 0) return;
    const ids = shas
      .filter((sha) => this.photos.some((p) => p.sha256 === sha))
      .map((sha) => this.photos.find((p) => p.sha256 === sha)!.id);
    if (ids.length > 0) this.removePhotos(ids);
    for (const sha of shas) this.submitPhotoOp(sha, { type: 'delete' });
  }

  // Announcements

  // Admin writes optimistically update one row and commit or roll it back after the response.

  annCreate(title: string, contentMd: string): void {
    const tempId = takeTempId();
    this.announcements = ops.applyAnnCreate(
      this.announcements,
      tempId,
      title,
      contentMd,
      Date.now(),
    );
    void (async () => {
      try {
        const created = await createAnnouncement(title, contentMd);
        this.tempIdMap.set(tempId, created.id);
        this.announcements = this.announcements.map((a) => (a.id === tempId ? created : a));
        this.flushPendingReorder();
      } catch (error) {
        console.error('[ann] create failed', error);
        // A create that never reached the server must not linger as a phantom row.
        this.announcements = this.announcements.filter((a) => a.id !== tempId);
        if (this.pendingReorder?.ids.includes(tempId)) this.pendingReorder = null;
        toast.error(copy.admin.announcement.publishFailed, {
          description: adminFailHint(error, ANN_TIMEOUT),
        });
      }
    })();
  }

  annUpdate(id: number, title: string, contentMd: string): void {
    const previous = this.announcements.find((a) => a.id === id);
    this.announcements = ops.applyAnnUpdate(this.announcements, id, title, contentMd, Date.now());
    void (async () => {
      try {
        await updateAnnouncement(id, title, contentMd);
      } catch (error) {
        console.error('[ann] update failed', error);
        // Restore only the edited row: a snapshot may have landed meanwhile, and a
        // whole-array rollback would discard those unrelated changes.
        if (previous) {
          this.announcements = this.announcements.map((a) => (a.id === id ? previous : a));
        }
        toast.error(copy.admin.announcement.saveFailed, {
          description: adminFailHint(error, ANN_TIMEOUT),
        });
      }
    })();
  }

  annDelete(id: number): void {
    const index = this.announcements.findIndex((a) => a.id === id);
    const previous = index >= 0 ? this.announcements[index] : undefined;
    this.announcements = ops.applyAnnDelete(this.announcements, id);
    void (async () => {
      try {
        await deleteAnnouncement(id);
      } catch (error) {
        console.error('[ann] delete failed', error);
        // Restore the deleted row at its prior position unless a snapshot already restored it.
        if (previous && !this.announcements.some((a) => a.id === id)) {
          const next = [...this.announcements];
          next.splice(Math.min(index, next.length), 0, previous);
          this.announcements = next;
        }
        toast.error(copy.admin.announcement.deleteFailed, {
          description: copy.admin.announcement.deleteRollback,
        });
      }
    })();
  }

  annReorder(orderedIds: number[]): void {
    const previousIds = this.announcements.map((announcement) => announcement.id);
    this.announcements = ops.applyReorder(this.announcements, orderedIds);
    const resolved = this.resolveIds(orderedIds);
    if (resolved.every((id) => id > 0)) {
      void this.submitReorder(resolved, previousIds);
      return;
    }
    // A just-created row still carries a temp id: keep the new order locally —
    // no "can't reorder yet" deadlock — and flush when the real id arrives.
    this.pendingReorder = { ids: orderedIds, previousIds };
  }

  private resolveIds(ids: number[]): number[] {
    return ids.map((id) => this.tempIdMap.get(id) ?? id);
  }

  private flushPendingReorder(): void {
    const pending = this.pendingReorder;
    if (!pending) return;
    const resolved = this.resolveIds(pending.ids);
    if (!resolved.every((id) => id > 0)) return;
    this.pendingReorder = null;
    // Clear temporary-ID mappings after all referenced creates complete.
    this.tempIdMap.clear();
    void this.submitReorder(resolved, pending.previousIds);
  }

  private async submitReorder(ids: number[], previousIds: number[]): Promise<void> {
    try {
      await reorderAnnouncements(ids);
    } catch (error) {
      console.error('[ann] reorder failed', error);
      this.announcements = ops.applyReorder(this.announcements, previousIds);
      toast.error(copy.admin.announcement.reorderFailed, {
        description: copy.admin.announcement.reorderRollback,
      });
    }
  }

  react(annId: number, emoji: string | null): void {
    this.announcements = ops.applyReact(this.announcements, annId, this.selfId, emoji);
    void this.submit({ type: 'react', target: annId, payload: { emoji } });
  }

  vote(annId: number, option: number | null): void {
    this.announcements = ops.applyVote(this.announcements, annId, this.selfId, option);
    void this.submit({ type: 'vote', target: annId, payload: { option } });
  }

  // Feedback

  fbCreate(contentMd: string): void {
    const tempId = takeTempId();
    this.feedback = ops.applyFbCreate(this.feedback, tempId, this.selfId, contentMd, Date.now());
    void this.submit({ type: 'fb_create', payload: { contentMd } });
  }

  fbDelete(id: number): void {
    const index = this.feedback.findIndex((f) => f.id === id);
    const previous = index >= 0 ? this.feedback[index] : undefined;
    this.feedback = ops.applyFbDelete(this.feedback, id);
    void (async () => {
      try {
        await deleteFeedback(id);
      } catch (error) {
        console.error('[fb] delete failed', error);
        // Restore only the deleted row, preserving unrelated snapshot changes.
        if (previous && !this.feedback.some((f) => f.id === id)) {
          const next = [...this.feedback];
          next.splice(Math.min(index, next.length), 0, previous);
          this.feedback = next;
        }
        toast.error(copy.admin.feedback.deleteFailed, {
          description: adminFailHint(error, FB_TIMEOUT),
        });
      }
    })();
  }

  /** Manual (root-only) display order. Rows seen on /admin always carry real ids. */
  fbReorder(orderedIds: number[]): void {
    const previousIds = this.feedback.map((item) => item.id);
    this.feedback = ops.applyReorder(this.feedback, orderedIds);
    const persisted = orderedIds.filter((id) => id > 0);
    void (async () => {
      try {
        await reorderFeedback(persisted);
      } catch (error) {
        console.error('[fb] reorder failed', error);
        this.feedback = ops.applyReorder(this.feedback, previousIds);
        toast.error(copy.admin.feedback.reorderFailed, {
          description: adminFailHint(error, FB_TIMEOUT),
        });
      }
    })();
  }

  /** Clear local state after SQL import and wait for a full snapshot. */
  resetAfterImport(): void {
    this.announcements = [];
    this.feedback = [];
  }
}

export function createAppStore(engine?: SyncEngine): AppState {
  const store = new AppState();
  if (engine) store.bindEngine(engine);
  return store;
}
