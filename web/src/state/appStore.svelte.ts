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

/** selfId arrives on every /sync and its uuid mapping is permanent, so it is cached in
 * localStorage for a first-frame identity on /admin; every /sync response overwrites it,
 * so a stale cache self-corrects. The id is public (see identity.ts), never a secret. */
const SELF_ID_KEY = 'infoto-self-id';

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

class AppState {
  engineState = $state<EngineState>({ syncing: false, pending: 0 });
  selfId = $state<number>(readCachedSelfId());
  photos = $state<Photo[]>([]);
  announcements = $state<Announcement[]>([]);
  feedback = $state<Feedback[]>([]);

  private tempIdMap = new Map<number, number>();
  private pendingReorder: { ids: number[]; previousIds: number[] } | null = null;
  private engine: SyncEngine | null = null;

  /** Bind engine state; repeated calls with the same engine are ignored. */
  bindEngine(engine: SyncEngine): void {
    if (this.engine === engine) return;
    this.engine = engine;
    engine.onState((state) => {
      this.engineState = { ...state };
    });
  }

  private submit(op: Op): Promise<number | null> {
    return this.engine?.addOp(op) ?? Promise.resolve(null);
  }

  /** Apply one authoritative full snapshot. */
  applySync(r: SyncResponse, context?: SyncSnapshotContext): void {
    this.selfId = r.selfId;
    try {
      localStorage.setItem(SELF_ID_KEY, String(r.selfId));
    } catch {
      /* noop */
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

    // Announcements are authoritative from the snapshot; a row whose create is
    // still in flight (temp id) is kept so it does not blink out before the
    // server row arrives. Failures roll the optimistic row back and surface a toast.
    const unconfirmed = this.announcements.filter((announcement) => announcement.id < 0);
    this.announcements = [...refolded.announcements, ...unconfirmed];

    // Feedback has no foldable op left (deletes go through /admin/feedback), so the
    // snapshot is authoritative for root; non-root visitors never receive rows.
    this.feedback = r.selfId === 0 ? (r.feedback ?? []) : [];
  }

  // Photos

  /** Optimistic root delete without confirmation. */
  private removePhotos(ids: number[]): void {
    this.photos = ops.applyDelete(this.photos, ids);
  }

  setMark(photoId: number, kind: ops.MarkKind, add: boolean): void {
    if (this.selfId < 0) return;
    this.photos = ops.applyMark(this.photos, photoId, kind, this.selfId, add);
    void this.submit({ type: ops.markOpType(kind, add), target: photoId });
  }

  /** Toggle one mark; likes and dislikes remain mutually exclusive. */
  toggleMark(photoId: number, kind: ops.MarkKind): void {
    const p = this.photos.find((x) => x.id === photoId);
    if (!p) return;
    const field = kind === 'like' ? 'likes' : kind === 'dislike' ? 'dislikes' : 'reports';
    const has = p[field].includes(this.selfId);
    if (!has && kind !== 'report') {
      // One photo can carry either like or dislike, never both.
      const other = kind === 'like' ? 'dislikes' : 'likes';
      const otherKind: ops.MarkKind = kind === 'like' ? 'dislike' : 'like';
      if (p[other].includes(this.selfId)) this.setMark(photoId, otherKind, false);
    }
    this.setMark(photoId, kind, !has);
  }

  setMarkMany(ids: number[], kind: ops.MarkKind, add: boolean): void {
    if (this.selfId < 0) return;
    this.photos = ops.applyMarkMany(this.photos, ids, kind, this.selfId, add);
    for (const id of ids) void this.submit({ type: ops.markOpType(kind, add), target: id });
  }

  /** Optimistic root delete for multi-selection. */
  deletePhotos(ids: number[]): void {
    if (this.selfId !== 0) return;
    this.removePhotos(ids);
    for (const id of ids) void this.submit({ type: 'delete', target: id });
  }

  // Announcements

  // Announcements are written through the root-only admin API, not /sync ops. Each write
  // resolves immediately (create returns the real id): the local row is optimistic, the
  // server row replaces it, and a failure rolls back that row and surfaces a toast.

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
        // Re-insert only the restored row at its old slot; if a snapshot already
        // brought it back, leave that row alone.
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
    // Every temp id the reorder referenced is real now, so the mapping is spent.
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
    const previous = this.feedback;
    this.feedback = ops.applyFbDelete(this.feedback, id);
    void (async () => {
      try {
        await deleteFeedback(id);
      } catch (error) {
        console.error('[fb] delete failed', error);
        this.feedback = previous;
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
