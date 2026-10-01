// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to reactive
// state. Every write goes op-log → /sync: mutate local state optimistically, append the
// op, let the engine submit.

import type {
  Announcement,
  Feedback,
  LocaleCode,
  Op,
  Photo,
  Poll,
  SyncResponse,
} from '$shared/types';
import { copy } from '$shared/copy';
import type { EngineState, SyncEngine, SyncSnapshotContext } from '../core/engine';
import { toast } from 'svelte-sonner';
import * as ops from '../core/ops';
import {
  ANN_TIMEOUT,
  FB_TIMEOUT,
  POLL_TIMEOUT,
  createAnnouncement,
  createPoll,
  deleteAnnouncement,
  deleteFeedback,
  deletePoll,
  reorderAnnouncements,
  reorderFeedback,
  reorderPolls,
  updateAnnouncement,
  updatePoll,
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

/** Facade sink, wired by the upload store once its pipeline exists. Layering note:
 *  appStore must not import the upload pipeline, so the upload store registers here. */
let mediaHostSink: ((url: string) => void) | null = null;

export function setMediaHostSink(sink: (url: string) => void): void {
  mediaHostSink = sink;
}

const setMediaHost = (url: string): void => mediaHostSink?.(url);

class AppState {
  engineState = $state<EngineState>({ syncing: false, pending: 0 });
  selfId = $state<number>(readCachedSelfId());
  photos = $state<Photo[]>([]);
  announcements = $state<Announcement[]>([]);
  polls = $state<Poll[]>([]);
  feedback = $state<Feedback[]>([]);
  /** Upload facade from the last /sync response. */
  mediaHostUrl = $state<string>('');

  private tempIdMap = new Map<number, number>();
  private pendingReorder: {
    locale: LocaleCode;
    ids: number[];
    previousIds: number[];
  } | null = null;
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
    // Uploads go straight to the facade; the SharedWorker needs the target before a job
    // can run, and a reconfigured facade must take effect without a reload.
    this.mediaHostUrl = r.mediaHostUrl;
    setMediaHost(r.mediaHostUrl);
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
      r.polls,
      context?.queuedOps ?? [],
      r.selfId,
    );
    this.photos = refolded.photos;

    // Keep pending creates alongside authoritative announcements until completion or rollback.
    const unconfirmed = this.announcements.filter((announcement) => announcement.id < 0);
    this.announcements = [...refolded.announcements, ...unconfirmed].sort(
      (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
    );
    this.polls = refolded.polls;

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

  annCreate(title: string, contentMd: string, locale: LocaleCode): void {
    const tempId = takeTempId();
    this.announcements = ops.applyAnnCreate(
      this.announcements,
      tempId,
      title,
      contentMd,
      locale,
      Date.now(),
    );
    void (async () => {
      try {
        const created = await createAnnouncement(title, contentMd, locale);
        this.tempIdMap.set(tempId, created.id);
        this.announcements = this.announcements
          .map((announcement) => (announcement.id === tempId ? created : announcement))
          .sort((a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id);
        this.flushPendingReorder();
      } catch (error) {
        console.error('[ann] create failed', error);
        this.announcements = this.announcements.filter(
          (announcement) => announcement.id !== tempId,
        );
        if (this.pendingReorder?.ids.includes(tempId)) this.pendingReorder = null;
        toast.error(copy.admin.announcement.publishFailed, {
          description: adminFailHint(error, ANN_TIMEOUT),
        });
      }
    })();
  }

  annUpdate(id: number, title: string, contentMd: string, locale: LocaleCode): void {
    const previous = this.announcements.find((announcement) => announcement.id === id);
    this.announcements = ops.applyAnnUpdate(
      this.announcements,
      id,
      title,
      contentMd,
      locale,
      Date.now(),
    );
    void (async () => {
      try {
        await updateAnnouncement(id, title, contentMd, locale);
      } catch (error) {
        console.error('[ann] update failed', error);
        if (previous) {
          this.announcements = this.announcements
            .map((announcement) => (announcement.id === id ? previous : announcement))
            .sort((a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id);
        }
        toast.error(copy.admin.announcement.saveFailed, {
          description: adminFailHint(error, ANN_TIMEOUT),
        });
      }
    })();
  }

  annDelete(id: number): void {
    const index = this.announcements.findIndex((announcement) => announcement.id === id);
    const previous = index >= 0 ? this.announcements[index] : undefined;
    this.announcements = ops.applyAnnDelete(this.announcements, id);
    void (async () => {
      try {
        await deleteAnnouncement(id);
      } catch (error) {
        console.error('[ann] delete failed', error);
        if (previous && !this.announcements.some((announcement) => announcement.id === id)) {
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

  private setAnnouncementLocaleOrder(locale: LocaleCode, orderedIds: number[]): void {
    const localeRows = this.announcements.filter((announcement) => announcement.locale === locale);
    const otherRows = this.announcements.filter((announcement) => announcement.locale !== locale);
    const ordered = ops.applyReorder(localeRows, orderedIds);
    this.announcements = [...otherRows, ...ordered].sort(
      (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
    );
  }

  annReorder(orderedIds: number[], locale: LocaleCode): void {
    const previousIds = this.announcements
      .filter((announcement) => announcement.locale === locale)
      .map((announcement) => announcement.id);
    if (previousIds.length === 0) return;
    this.setAnnouncementLocaleOrder(locale, orderedIds);
    const resolved = this.resolveIds(orderedIds);
    if (resolved.every((id) => id > 0)) {
      void this.submitReorder(resolved, previousIds, locale);
      return;
    }
    this.pendingReorder = { locale, ids: orderedIds, previousIds };
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
    this.tempIdMap.clear();
    void this.submitReorder(resolved, pending.previousIds, pending.locale);
  }

  private async submitReorder(
    ids: number[],
    previousIds: number[],
    locale: LocaleCode,
  ): Promise<void> {
    try {
      await reorderAnnouncements(ids, locale);
    } catch (error) {
      console.error('[ann] reorder failed', error);
      this.setAnnouncementLocaleOrder(locale, previousIds);
      toast.error(copy.admin.announcement.reorderFailed, {
        description: copy.admin.announcement.reorderRollback,
      });
    }
  }

  react(annId: number, emoji: string | null): void {
    this.announcements = ops.applyReact(this.announcements, annId, this.selfId, emoji);
    void this.submit({ type: 'react', target: annId, payload: { emoji } });
  }

  vote(pollId: number, options: number[]): void {
    this.polls = ops.applyVote(this.polls, pollId, this.selfId, options);
    void this.submit({ type: 'vote', target: pollId, payload: { options } });
  }

  // Polls are root-managed, while vote operations travel through the normal sync log.

  async pollCreate(
    title: string,
    options: string[],
    allowMultiple: boolean,
    locale: LocaleCode,
  ): Promise<Poll> {
    const created = await createPoll(title, options, allowMultiple, locale);
    this.polls = [...this.polls, created].sort(
      (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
    );
    return created;
  }

  async pollUpdate(
    id: number,
    title: string,
    options: string[],
    allowMultiple: boolean,
    locale: LocaleCode,
  ): Promise<void> {
    const previous = this.polls.find((poll) => poll.id === id);
    this.polls = this.polls.map((poll) =>
      poll.id === id ? { ...poll, title, options, allowMultiple, updatedAt: Date.now() } : poll,
    );
    try {
      await updatePoll(id, title, options, allowMultiple, locale);
    } catch (error) {
      if (previous) this.polls = this.polls.map((poll) => (poll.id === id ? previous : poll));
      throw error;
    }
  }

  async pollDelete(id: number): Promise<void> {
    const previous = this.polls.find((poll) => poll.id === id);
    this.polls = this.polls.filter((poll) => poll.id !== id);
    try {
      await deletePoll(id);
    } catch (error) {
      if (previous && !this.polls.some((poll) => poll.id === id)) {
        this.polls = [...this.polls, previous].sort(
          (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
        );
      }
      throw error;
    }
  }

  pollReorder(orderedIds: number[], locale: LocaleCode): void {
    const previousIds = this.polls.filter((poll) => poll.locale === locale).map((poll) => poll.id);
    if (previousIds.length === 0) return;
    const reorderLocale = (ids: number[]) => {
      const selected = this.polls.filter((poll) => poll.locale === locale);
      const otherLocales = this.polls.filter((poll) => poll.locale !== locale);
      this.polls = [...otherLocales, ...ops.applyReorder(selected, ids)].sort(
        (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
      );
    };
    reorderLocale(orderedIds);
    void (async () => {
      try {
        await reorderPolls(orderedIds, locale);
      } catch (error) {
        console.error('[poll] reorder failed', error);
        reorderLocale(previousIds);
        toast.error(copy.admin.poll.reorderFailed, {
          description: adminFailHint(error, POLL_TIMEOUT),
        });
      }
    })();
  }

  // Feedback

  fbCreate(contentMd: string, locale: LocaleCode): void {
    const tempId = takeTempId();
    this.feedback = ops.applyFbCreate(
      this.feedback,
      tempId,
      this.selfId,
      contentMd,
      locale,
      Date.now(),
    );
    void this.submit({ type: 'fb_create', payload: { contentMd, locale } });
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
  fbReorder(orderedIds: number[], locale: LocaleCode): void {
    const localeRows = this.feedback.filter((item) => item.locale === locale);
    const previousIds = localeRows.map((item) => item.id);
    if (previousIds.length === 0) return;
    const reorderLocale = (ids: number[]) => {
      const selected = this.feedback.filter((item) => item.locale === locale);
      const otherLocales = this.feedback.filter((item) => item.locale !== locale);
      this.feedback = [...otherLocales, ...ops.applyReorder(selected, ids)].sort(
        (a, b) => a.locale.localeCompare(b.locale) || a.sort - b.sort || a.id - b.id,
      );
    };
    reorderLocale(orderedIds);
    const persisted = orderedIds.filter((id) => id > 0);
    void (async () => {
      try {
        await reorderFeedback(persisted, locale);
      } catch (error) {
        console.error('[fb] reorder failed', error);
        reorderLocale(previousIds);
        toast.error(copy.admin.feedback.reorderFailed, {
          description: adminFailHint(error, FB_TIMEOUT),
        });
      }
    })();
  }

  /** Clear local state after SQL import and wait for a full snapshot. */
  resetAfterImport(): void {
    this.announcements = [];
    this.polls = [];
    this.feedback = [];
  }
}

export function createAppStore(engine?: SyncEngine): AppState {
  const store = new AppState();
  if (engine) store.bindEngine(engine);
  return store;
}
