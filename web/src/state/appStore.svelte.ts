// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to reactive
// state. Every write goes op-log → /sync: mutate local state optimistically, append the
// op, let the engine submit. Call sites: createAppStore([engine]), bindEngine, applySync, removePhotos.

import type { Announcement, Feedback, Op, Photo, SyncResponse } from '$shared/types';
import type { EngineState, SyncEngine, SyncSnapshotContext } from '../core/sync/engine';
import type { PipelineTaskSnapshot } from '../transcode/pipeline';
import * as ops from '../core/ops';
import {
  createAnnouncement,
  deleteAnnouncement,
  reorderAnnouncements,
  updateAnnouncement,
} from '../core/api/announcements';

/** Allocate descending temporary IDs for optimistic announcements and feedback. */
let nextTempId = -1;
const takeTempId = (): number => nextTempId--;

/**
 * selfId arrives on every /sync and its uuid mapping is permanent, so it is cached in
 * localStorage for a first-frame identity on /admin; every /sync response overwrites it,
 * so a stale cache self-corrects. The id is public (see identity.ts), never a secret.
 */
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
  lastSync = $state<SyncResponse | null>(null);
  /** Task snapshots keyed by job ID. */
  tasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());
  log = $state<string[]>([]);
  selfId = $state<number>(readCachedSelfId());
  photos = $state<Photo[]>([]);
  announcements = $state<Announcement[]>([]);
  feedback = $state<Feedback[]>([]);
  /** Per-announcement save state: 'saving' in flight, 'error' when it failed. */
  annSave = $state<Record<number, 'saving' | 'error'>>({});
  /** True while a reorder write is in flight. */
  annReordering = $state(false);

  private pendingFbTempIds: number[] = [];
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
  applySync(r: SyncResponse, _context?: SyncSnapshotContext): Map<number, number> {
    this.selfId = r.selfId;
    try {
      localStorage.setItem(SELF_ID_KEY, String(r.selfId));
    } catch {
      /* noop */
    }
    this.photos = r.photos;

    // Announcements are authoritative from the snapshot; optimistic rows that
    // are still saving (temp id) or failed are kept so an unsaved edit is
    // never silently dropped.
    const unconfirmed = this.announcements.filter(
      (announcement) => announcement.id < 0 || this.annSave[announcement.id] === 'error',
    );
    this.announcements = [...r.announcements, ...unconfirmed];

    this.feedback = r.selfId === 0 ? r.feedback : [];
    this.pendingFbTempIds = [];
    this.lastSync = r;
    // Announcement writes go through the admin API, so no queued op references
    // an announcement temp id any more — nothing to remap.
    return new Map<number, number>();
  }

  // Photos

  /** Optimistic root delete without confirmation. */
  removePhotos(ids: number[]): void {
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
  // resolves immediately (create returns the real id), so there is no wait window: the local
  // row is optimistic, the server row replaces it, and a failure marks only that one row.

  annCreate(title: string, contentMd: string): void {
    const tempId = takeTempId();
    this.announcements = ops.applyAnnCreate(
      this.announcements,
      tempId,
      title,
      contentMd,
      Date.now(),
    );
    this.annSave[tempId] = 'saving';
    void (async () => {
      try {
        const created = await createAnnouncement(title, contentMd);
        this.tempIdMap.set(tempId, created.id);
        this.announcements = this.announcements.map((a) => (a.id === tempId ? created : a));
        delete this.annSave[tempId];
        this.flushPendingReorder();
      } catch (error) {
        console.error('[ann] create failed', error);
        this.annSave[tempId] = 'error';
      }
    })();
  }

  annUpdate(id: number, title: string, contentMd: string): void {
    this.announcements = ops.applyAnnUpdate(this.announcements, id, title, contentMd, Date.now());
    this.annSave[id] = 'saving';
    void (async () => {
      try {
        await updateAnnouncement(id, title, contentMd);
        delete this.annSave[id];
      } catch (error) {
        console.error('[ann] update failed', error);
        this.annSave[id] = 'error';
      }
    })();
  }

  annDelete(id: number): void {
    const previous = this.announcements;
    this.announcements = ops.applyAnnDelete(this.announcements, id);
    void (async () => {
      try {
        await deleteAnnouncement(id);
      } catch (error) {
        console.error('[ann] delete failed', error);
        this.announcements = previous;
      }
    })();
  }

  annReorder(orderedIds: number[]): void {
    const previousIds = this.announcements.map((announcement) => announcement.id);
    this.announcements = ops.applyAnnReorder(this.announcements, orderedIds);
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
    void this.submitReorder(resolved, pending.previousIds);
  }

  private async submitReorder(ids: number[], previousIds: number[]): Promise<void> {
    this.annReordering = true;
    try {
      await reorderAnnouncements(ids);
    } catch (error) {
      console.error('[ann] reorder failed', error);
      this.announcements = ops.rollbackAnnouncementOrder(this.announcements, previousIds);
    } finally {
      this.annReordering = false;
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
    this.pendingFbTempIds.push(tempId);
    void this.submit({ type: 'fb_create', payload: { contentMd } });
  }

  fbDelete(id: number): void {
    this.feedback = ops.applyFbDelete(this.feedback, id);
    void this.submit({ type: 'fb_delete', target: id });
  }

  /** Clear local state after SQL import and wait for a full snapshot. */
  resetAfterImport(): void {
    this.announcements = [];
    this.feedback = [];
    this.pendingFbTempIds = [];
  }
}

export type AppStore = AppState;

export function createAppStore(engine?: SyncEngine): AppState {
  const store = new AppState();
  if (engine) store.bindEngine(engine);
  return store;
}
