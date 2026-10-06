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
import { activeLocale, copy } from '$shared/copy';
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

/** Toast text for one failed admin write, shared by every resource and action. */
interface AdminToasts {
  createFailed: string;
  updateFailed: string;
  deleteFailed: string;
  reorderFailed: string;
  deleteRollback: string;
  reorderRollback: string;
}

/**
 * One admin-managed collection's optimistic write path.
 *
 * Announcements and polls differ only in their reducers, API calls and toast text, so the
 * lifecycle lives here once: allocate a temporary id, apply the optimistic row, commit or
 * roll back, and defer a reorder that still references a temporary id.
 */
class AdminCollection<T extends { id: number; sort: number; locale: LocaleCode }> {
  private tempIds = new Map<number, number>();
  private pendingReorder: {
    locale: LocaleCode;
    ids: number[];
    previousIds: number[];
    call: (ids: number[]) => Promise<void>;
  } | null = null;

  constructor(
    private config: {
      /** One locale's rows, read through a getter so the store owns the reactive buckets. */
      rows: (locale: LocaleCode) => T[];
      /** Replace one locale's rows with a pure reducer's result. Writes are addressed by
       *  locale, so a request that resolves after a language switch still lands in the
       *  language it was made for. */
      setRows: (locale: LocaleCode, rows: T[]) => void;
      timeoutId: string;
      toasts: AdminToasts;
    },
  ) {}

  /** Insert an optimistic row under `tempId` and commit it once the server assigns an id. */
  async create(
    tempId: number,
    locale: LocaleCode,
    optimistic: (rows: T[]) => T[],
    call: () => Promise<T>,
  ): Promise<void> {
    this.config.setRows(locale, optimistic(this.config.rows(locale)));
    try {
      const created = await call();
      this.tempIds.set(tempId, created.id);
      this.config.setRows(
        locale,
        this.config.rows(locale).map((row) => (row.id === tempId ? created : row)),
      );
      this.flushPendingReorder();
    } catch (error) {
      console.error('[admin] create failed', error);
      this.config.setRows(
        locale,
        this.config.rows(locale).filter((row) => row.id !== tempId),
      );
      if (this.pendingReorder?.ids.includes(tempId)) this.pendingReorder = null;
      toast.error(this.config.toasts.createFailed, {
        description: adminFailHint(error, this.config.timeoutId),
      });
    }
  }

  /** Apply an edit and restore the edited row only, never the whole list. */
  async update(
    id: number,
    locale: LocaleCode,
    optimistic: (rows: T[]) => T[],
    call: () => Promise<void>,
  ): Promise<void> {
    const previous = this.config.rows(locale).find((row) => row.id === id);
    this.config.setRows(locale, optimistic(this.config.rows(locale)));
    try {
      await call();
    } catch (error) {
      console.error('[admin] update failed', error);
      // Restore only the edited row: a snapshot may have landed meanwhile, and a
      // whole-array rollback would discard those unrelated changes.
      if (previous) {
        this.config.setRows(
          locale,
          this.config.rows(locale).map((row) => (row.id === id ? previous : row)),
        );
      }
      toast.error(this.config.toasts.updateFailed, {
        description: adminFailHint(error, this.config.timeoutId),
      });
    }
  }

  /** Remove a row and put it back at its prior position unless a snapshot restored it. */
  async remove(id: number, locale: LocaleCode, call: () => Promise<void>): Promise<void> {
    const rows = this.config.rows(locale);
    const index = rows.findIndex((row) => row.id === id);
    const previous = index >= 0 ? rows[index] : undefined;
    this.config.setRows(
      locale,
      rows.filter((row) => row.id !== id),
    );
    try {
      await call();
    } catch (error) {
      console.error('[admin] delete failed', error);
      if (previous && !this.config.rows(locale).some((row) => row.id === id)) {
        const next = [...this.config.rows(locale)];
        next.splice(Math.min(index, next.length), 0, previous);
        this.config.setRows(locale, next);
      }
      toast.error(this.config.toasts.deleteFailed, {
        description: `${this.config.toasts.deleteRollback} · ${adminFailHint(error, this.config.timeoutId)}`,
      });
    }
  }

  /** Reorder one locale at once; a still-temporary id defers the submit until it resolves. */
  reorder(locale: LocaleCode, orderedIds: number[], call: (ids: number[]) => Promise<void>): void {
    const previousIds = this.config.rows(locale).map((row) => row.id);
    this.config.setRows(locale, ops.applyReorder(this.config.rows(locale), orderedIds));
    const resolved = this.resolveIds(orderedIds);
    if (resolved.every((id) => id > 0)) {
      void this.submitReorder(resolved, previousIds, locale, call);
      return;
    }
    // A just-created row still carries a temp id: keep the new order locally —
    // no "can't reorder yet" deadlock — and flush when the real id arrives.
    this.pendingReorder = { locale, ids: orderedIds, previousIds, call };
  }

  private resolveIds(ids: number[]): number[] {
    return ids.map((id) => this.tempIds.get(id) ?? id);
  }

  private flushPendingReorder(): void {
    const pending = this.pendingReorder;
    if (!pending) return;
    const resolved = this.resolveIds(pending.ids);
    if (!resolved.every((id) => id > 0)) return;
    this.pendingReorder = null;
    // Clear temporary-ID mappings after all referenced creates complete.
    this.tempIds.clear();
    void this.submitReorder(resolved, pending.previousIds, pending.locale, pending.call);
  }

  private async submitReorder(
    ids: number[],
    previousIds: number[],
    locale: LocaleCode,
    call: (ids: number[]) => Promise<void>,
  ): Promise<void> {
    try {
      await call(ids);
    } catch (error) {
      console.error('[admin] reorder failed', error);
      this.config.setRows(locale, ops.applyReorder(this.config.rows(locale), previousIds));
      toast.error(this.config.toasts.reorderFailed, {
        description: `${this.config.toasts.reorderRollback} · ${adminFailHint(error, this.config.timeoutId)}`,
      });
    }
  }
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

/** Pending-card cancel sink, wired by the upload store. Same layering note as above: a
 *  pending card belongs to the upload pipeline, and appStore cannot import it. */
let pendingUploadCancelSink: ((sha: string) => void) | null = null;

export function setPendingUploadCancelSink(sink: (sha: string) => void): void {
  pendingUploadCancelSink = sink;
}

const cancelPendingUpload = (sha: string): void => pendingUploadCancelSink?.(sha);

/** One locale's slice of an all-locale list; order is preserved. */
function localeSlice<T extends { locale: LocaleCode }>(all: T[], locale: LocaleCode): T[] {
  return all.filter((row) => row.locale === locale);
}

/** Swap one locale's rows inside an all-locale list, leaving the other locales untouched. */
function replaceLocale<T extends { locale: LocaleCode }>(
  all: T[],
  locale: LocaleCode,
  rows: T[],
): T[] {
  return [...all.filter((row) => row.locale !== locale), ...rows];
}

/** Authoritative rows plus the local-only ones (temp ids) a snapshot must not drop. */
function keepLocalOnly<T extends { id: number; sort: number }>(server: T[], local: T[]): T[] {
  return [...server, ...local.filter((row) => row.id < 0)].sort(
    (a, b) => a.sort - b.sort || a.id - b.id,
  );
}

class AppState {
  engineState = $state<EngineState>({ syncing: false, pending: 0 });
  selfId = $state<number>(readCachedSelfId());
  photos = $state<Photo[]>([]);
  contentLocale = $state<LocaleCode>(activeLocale());
  /** Every locale's content rows. The public lists below are the active locale's slice, so
   *  a language switch is a local re-render rather than another round trip. */
  private allAnnouncements = $state<Announcement[]>([]);
  private allPolls = $state<Poll[]>([]);
  private allFeedback = $state<Feedback[]>([]);
  announcements = $derived(localeSlice(this.allAnnouncements, this.contentLocale));
  polls = $derived(localeSlice(this.allPolls, this.contentLocale));
  feedback = $derived(localeSlice(this.allFeedback, this.contentLocale));
  /** Upload facade from the last /sync response. */
  mediaHostUrl = $state<string>('');

  private engineUnsubscribe: (() => void) | null = null;

  private announcementRows = new AdminCollection<Announcement>({
    rows: (locale) => localeSlice(this.allAnnouncements, locale),
    setRows: (locale, rows) => {
      this.allAnnouncements = replaceLocale(this.allAnnouncements, locale, rows);
    },
    timeoutId: ANN_TIMEOUT,
    toasts: {
      createFailed: copy.admin.announcement.publishFailed,
      updateFailed: copy.admin.announcement.saveFailed,
      deleteFailed: copy.admin.announcement.deleteFailed,
      reorderFailed: copy.admin.announcement.reorderFailed,
      deleteRollback: copy.admin.announcement.deleteRollback,
      reorderRollback: copy.admin.announcement.reorderRollback,
    },
  });

  private pollRows = new AdminCollection<Poll>({
    rows: (locale) => localeSlice(this.allPolls, locale),
    setRows: (locale, rows) => {
      this.allPolls = replaceLocale(this.allPolls, locale, rows);
    },
    timeoutId: POLL_TIMEOUT,
    toasts: {
      createFailed: copy.admin.poll.publishFailed,
      updateFailed: copy.admin.poll.saveFailed,
      deleteFailed: copy.admin.poll.deleteFailed,
      reorderFailed: copy.admin.poll.reorderFailed,
      deleteRollback: copy.admin.poll.deleteRollback,
      reorderRollback: copy.admin.poll.reorderRollback,
    },
  });

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

  /** Switch the language on screen. The snapshot already carries every locale, so this is
   *  a local re-render: no list is cleared and no request is issued. */
  setContentLocale(locale: LocaleCode): void {
    this.contentLocale = locale;
  }

  /** Apply one authoritative full snapshot, covering every locale at once. */
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
    const refolded = ops.reapplyQueued(
      r.photos,
      r.announcements,
      r.polls,
      context?.queuedOps ?? [],
      r.selfId,
    );
    this.photos = refolded.photos;
    // The snapshot covers every locale, so an in-flight admin create filed under a
    // language the user has since switched away from is neither lost nor leaked: the
    // local-only row stays in its own bucket, and the views follow `contentLocale`.
    this.allAnnouncements = keepLocalOnly(refolded.announcements, this.allAnnouncements);
    this.allPolls = keepLocalOnly(refolded.polls, this.allPolls);

    // Feedback has no foldable op left (deletes go through /admin/feedback), so the
    // snapshot is authoritative for root; non-root visitors never receive rows.
    this.allFeedback = r.selfId === 0 ? r.feedback : [];
  }

  // Photos

  private submitPhotoOp(sha256: string, op: Op): void {
    if (!sha256) return;
    void this.submit({ ...op, targetSha: sha256 });
  }

  /**
   * A pending card's sha has no server row, so there is nothing to delete remotely: the queued
   * upload op is withdrawn instead, and the card's own cancel (registered by the upload store)
   * stops an in-flight transfer before it can write one. The delete op is still filed — after
   * the withdrawal resolves — as the tombstone that covers the race where the upload op was
   * already claimed by an in-flight sync request and lands anyway: create then delete, net
   * nothing. That is also why the withdrawal must run first: it matches every op by sha and
   * would otherwise take the tombstone with it.
   */
  private async withdrawPendingUpload(sha: string): Promise<void> {
    // The card goes regardless — a failed transcode carries no sha and still has a card.
    cancelPendingUpload(sha);
    if (!sha || !this.engine) return;
    await this.engine.removeOpsBySha(sha);
    await this.submit({ type: 'delete', targetSha: sha });
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
    const known = new Set(this.photos.map((p) => p.sha256));
    const ids = shas
      .filter((sha) => known.has(sha))
      .map((sha) => this.photos.find((p) => p.sha256 === sha)!.id);
    if (ids.length > 0) this.removePhotos(ids);
    for (const sha of shas) {
      if (known.has(sha)) this.submitPhotoOp(sha, { type: 'delete' });
      else void this.withdrawPendingUpload(sha);
    }
  }

  // Announcements

  // Admin writes optimistically update one row and commit or roll it back after the response.
  // Every write carries this store's content locale, which is the same value the optimistic
  // row was filed under — never a second read of the UI locale.

  annCreate(title: string, contentMd: string): void {
    const locale = this.contentLocale;
    const tempId = takeTempId();
    void this.announcementRows.create(
      tempId,
      locale,
      (rows) => ops.applyAnnCreate(rows, tempId, title, contentMd, locale, Date.now()),
      () => createAnnouncement(title, contentMd, locale),
    );
  }

  annUpdate(id: number, title: string, contentMd: string): void {
    const locale = this.contentLocale;
    void this.announcementRows.update(
      id,
      locale,
      (rows) => ops.applyAnnUpdate(rows, id, title, contentMd, Date.now()),
      () => updateAnnouncement(id, title, contentMd, locale),
    );
  }

  annDelete(id: number): void {
    void this.announcementRows.remove(id, this.contentLocale, () => deleteAnnouncement(id));
  }

  annReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.announcementRows.reorder(locale, orderedIds, (ids) => reorderAnnouncements(ids, locale));
  }

  // Polls

  pollCreate(options: string[], allowMultiple: boolean): void {
    const locale = this.contentLocale;
    const tempId = takeTempId();
    void this.pollRows.create(
      tempId,
      locale,
      (rows) => ops.applyPollCreate(rows, tempId, options, allowMultiple, locale, Date.now()),
      () => createPoll(options, allowMultiple, locale),
    );
  }

  pollUpdate(id: number, options: string[], allowMultiple: boolean): void {
    const locale = this.contentLocale;
    void this.pollRows.update(
      id,
      locale,
      (rows) => ops.applyPollUpdate(rows, id, options, allowMultiple, Date.now()),
      () => updatePoll(id, options, allowMultiple, locale),
    );
  }

  pollDelete(id: number): void {
    void this.pollRows.remove(id, this.contentLocale, () => deletePoll(id));
  }

  pollReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.pollRows.reorder(locale, orderedIds, (ids) => reorderPolls(ids, locale));
  }

  react(annId: number, emoji: string | null): void {
    this.allAnnouncements = ops.applyReact(this.allAnnouncements, annId, this.selfId, emoji);
    void this.submit({ type: 'react', target: annId, payload: { emoji } });
  }

  vote(pollId: number, options: number[]): void {
    this.allPolls = ops.applyVote(this.allPolls, pollId, this.selfId, options);
    void this.submit({ type: 'vote', target: pollId, payload: { options } });
  }

  // Feedback

  fbCreate(contentMd: string, locale: LocaleCode = this.contentLocale): void {
    const tempId = takeTempId();
    this.allFeedback = ops.applyFbCreate(
      this.allFeedback,
      tempId,
      this.selfId,
      contentMd,
      locale,
      Date.now(),
    );
    void this.submit({ type: 'fb_create', payload: { contentMd, locale } });
  }

  fbDelete(id: number): void {
    const locale = this.contentLocale;
    const rows = localeSlice(this.allFeedback, locale);
    const index = rows.findIndex((f) => f.id === id);
    const previous = index >= 0 ? rows[index] : undefined;
    this.allFeedback = replaceLocale(this.allFeedback, locale, ops.applyFbDelete(rows, id));
    void (async () => {
      try {
        await deleteFeedback(id);
      } catch (error) {
        console.error('[fb] delete failed', error);
        // Restore only the deleted row, preserving unrelated snapshot changes.
        const current = localeSlice(this.allFeedback, locale);
        if (previous && !current.some((f) => f.id === id)) {
          const next = [...current];
          next.splice(Math.min(index, next.length), 0, previous);
          this.allFeedback = replaceLocale(this.allFeedback, locale, next);
        }
        toast.error(copy.admin.feedback.deleteFailed, {
          description: adminFailHint(error, FB_TIMEOUT),
        });
      }
    })();
  }

  /** Manual (root-only) display order. Rows seen on /admin always carry real ids. */
  fbReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    const rows = localeSlice(this.allFeedback, locale);
    const previousIds = rows.map((item) => item.id);
    this.allFeedback = replaceLocale(this.allFeedback, locale, ops.applyReorder(rows, orderedIds));
    const persisted = orderedIds.filter((id) => id > 0);
    void (async () => {
      try {
        await reorderFeedback(persisted, locale);
      } catch (error) {
        console.error('[fb] reorder failed', error);
        this.allFeedback = replaceLocale(
          this.allFeedback,
          locale,
          ops.applyReorder(localeSlice(this.allFeedback, locale), previousIds),
        );
        toast.error(copy.admin.feedback.reorderFailed, {
          description: adminFailHint(error, FB_TIMEOUT),
        });
      }
    })();
  }

  /** Clear local state after SQL import and wait for a full snapshot. */
  resetAfterImport(): void {
    this.allAnnouncements = [];
    this.allPolls = [];
    this.allFeedback = [];
  }
}

export function createAppStore(engine?: SyncEngine): AppState {
  const store = new AppState();
  if (engine) store.bindEngine(engine);
  return store;
}
