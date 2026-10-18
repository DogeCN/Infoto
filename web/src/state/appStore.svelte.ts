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
  /** Feedback's delete/reorder write no rollback line; the hint alone is its description. */
  deleteRollback?: string;
  reorderRollback?: string;
}

/** One toast description for a failed admin write: the rollback note, then the failure hint. */
function failDescription(rollback: string | undefined, error: unknown, timeoutId: string): string {
  return [rollback, adminFailHint(error, timeoutId)].filter(Boolean).join(' · ');
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
      /** Whether a reorder may name a temporary id. Announcements and polls can — a create
       *  may still be in flight — and the submit waits for the real id. Feedback rows on
       *  /admin always carry real ids; an optimistic `fb_create` has no id mapping, so a
       *  negative id is dropped from the request instead of parking the reorder forever. */
      resolvesTempIds?: boolean;
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
        description: failDescription(
          this.config.toasts.deleteRollback,
          error,
          this.config.timeoutId,
        ),
      });
    }
  }

  /** Reorder one locale at once; a still-temporary id defers the submit until it resolves. */
  reorder(locale: LocaleCode, orderedIds: number[], call: (ids: number[]) => Promise<void>): void {
    const previousIds = this.config.rows(locale).map((row) => row.id);
    this.config.setRows(locale, ops.applyReorder(this.config.rows(locale), orderedIds));
    const resolved = this.resolveIds(orderedIds);
    if (this.config.resolvesTempIds === false) {
      void this.submitReorder(
        resolved.filter((id) => id > 0),
        previousIds,
        locale,
        call,
      );
      return;
    }
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
        description: failDescription(
          this.config.toasts.reorderRollback,
          error,
          this.config.timeoutId,
        ),
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

function readCachedPendingMarks(): Map<string, ops.MarkSet> {
  try {
    const raw = localStorage.getItem(PENDING_MARKS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as [string, ops.MarkSet][];
      return new Map(parsed);
    }
  } catch {
    /* noop */
  }
  return new Map();
}

function writePendingMarks(marks: Map<string, ops.MarkSet>): void {
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

  private feedbackRows = new AdminCollection<Feedback>({
    rows: (locale) => localeSlice(this.allFeedback, locale),
    setRows: (locale, rows) => {
      this.allFeedback = replaceLocale(this.allFeedback, locale, rows);
    },
    timeoutId: FB_TIMEOUT,
    resolvesTempIds: false,
    toasts: {
      // Feedback has no optimistic create/update; only remove and reorder read these.
      createFailed: copy.admin.feedback.deleteFailed,
      updateFailed: copy.admin.feedback.deleteFailed,
      deleteFailed: copy.admin.feedback.deleteFailed,
      reorderFailed: copy.admin.feedback.reorderFailed,
    },
  });

  /** Optimistic marks on photos whose row does not exist server-side yet, keyed by sha256
   *  (the same address photo ops use). Merged into the pending cards so they highlight. */
  pendingMarks = $state<Map<string, ops.MarkSet>>(readCachedPendingMarks());

  private engine: SyncEngine | null = null;

  /** Shas whose row now exists — the snapshot carries it, or its upload op was just written.
   *  Plain (not `$state`): nothing renders from it. */
  private queuedUploadShas = new Set<string>();

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
    const landed = new Set(this.photos.map((p) => p.sha256));
    // A row that just arrived also states the marks its pending card was showing: its upload op
    // was written in an earlier page session, so `photoOpQueued` will not fire for it again.
    for (const sha of [...this.queuedUploadShas, ...this.pendingMarks.keys()]) {
      if (landed.has(sha)) void this.photoOpQueued(sha);
    }
    // A sha the snapshot carries needs no upload-op flag: the row exists, so its ops go
    // straight to the log. Dropping it here keeps the set from growing all session.
    for (const sha of landed) this.queuedUploadShas.delete(sha);
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

  /**
   * Submit one mark, dropping it while the row it targets does not exist yet. Marks are the
   * ops that *need* the row: a photo op is addressed by sha256 and /sync applies a batch in
   * array order, so a mark sent before its upload is a no-op on an unknown sha
   * (`resolvePhotoId` → null) and is then cleared as confirmed — the mark would be lost. The
   * mark itself is already recorded in `pendingMarks`, and `photoOpQueued` states it as an op
   * once the row exists.
   *
   * A delete is the opposite case and does not come through here: deleting an unknown sha is a
   * harmless no-op on the server, and the tombstone that withdraws a pending photo depends on
   * exactly that. `deletePhotos` submits its op directly, after the optimistic removal has
   * already taken the row out of `photos` — routing it through this guard dropped every
   * deletion silently, and the photo came back on the next snapshot.
   */
  private submitMarkOp(sha256: string, op: Op): void {
    if (!sha256) return;
    if (!this.queuedUploadShas.has(sha256) && !this.photos.some((p) => p.sha256 === sha256)) {
      return;
    }
    void this.submit({ ...op, targetSha: sha256 });
  }

  /**
   * The row for `sha256` exists now: state every mark its pending card is showing as an op.
   * Awaited by the caller, so the marks land after the upload op by construction rather than by
   * IndexedDB transaction ordering.
   *
   * The marks are the source, not a queue of clicks: the row is new, so its server-side marks
   * are empty and the marks on screen are exactly the delta. That is also what makes this
   * reload-proof — `pendingMarks` is persisted, a queue of ops would not be.
   */
  async photoOpQueued(sha256: string): Promise<void> {
    if (!sha256) return;
    this.queuedUploadShas.add(sha256);
    const marks = this.pendingMarks.get(sha256);
    if (!marks) return;
    const adds: Op[] = [];
    for (const kind of ['like', 'dislike', 'report'] as const) {
      if (marks[ops.MARK_FIELD[kind]].includes(this.selfId)) {
        adds.push({ type: ops.markOpType(kind, true), targetSha: sha256 });
      }
    }
    await Promise.all(adds.map((op) => this.submit(op)));
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
    // Nothing will ever state these marks: the row they belong to is not coming.
    this.queuedUploadShas.delete(sha256);
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

  /** Marks of a pending card, merged into its render model. Returns the shared empty set when
   *  the card has none, so the projection's reference comparison stays meaningful. */
  pendingMarksFor(sha256: string): ops.MarkSet {
    return this.pendingMarks.get(sha256) ?? ops.EMPTY_MARKS;
  }

  /** Apply one mark to a pending card and replace the map entry. */
  private setPendingMark(sha256: string, kind: ops.MarkKind, add: boolean): void {
    const cur = this.pendingMarks.get(sha256) ?? ops.EMPTY_MARKS;
    const marks = new Map(this.pendingMarks);
    marks.set(sha256, ops.applyMarkToSet(cur, kind, this.selfId, add));
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
    this.submitMarkOp(sha256, { type: ops.markOpType(kind, add) });
  }

  /** Toggle one mark. Like and dislike are one choice: `applyMarkToSet` clears the opposite
   *  column locally and the server clears it in the same statement it writes the mark, so one
   *  op states the whole change — there is no paired removal op to send. */
  toggleMark(sha256: string, kind: ops.MarkKind): void {
    const p = this.photos.find((x) => x.sha256 === sha256);
    const field = ops.MARK_FIELD[kind];
    const has = p
      ? p[field].includes(this.selfId)
      : (this.pendingMarks.get(sha256)?.[field] ?? []).includes(this.selfId);
    this.setMarkBySha(sha256, kind, !has);
  }

  setMarkMany(shas: string[], kind: ops.MarkKind, add: boolean): void {
    if (this.selfId < 0) return;
    const unique = [...new Set(shas)];
    // One index per call: a sha lookup inside the loop was O(selection × album).
    const bySha = new Map(this.photos.map((photo) => [photo.sha256, photo]));
    const ids: number[] = [];
    for (const sha of unique) {
      const photo = bySha.get(sha);
      if (photo) ids.push(photo.id);
      else this.setPendingMark(sha, kind, add);
    }
    if (ids.length > 0) {
      this.photos = ops.applyMarkMany(this.photos, ids, kind, this.selfId, add);
    }
    for (const sha of unique) this.submitMarkOp(sha, { type: ops.markOpType(kind, add) });
  }

  /** Optimistic root delete for multi-selection (sha-addressed, pending cards included). */
  deletePhotos(shas: string[]): void {
    if (this.selfId !== 0) return;
    const bySha = new Map(this.photos.map((photo) => [photo.sha256, photo]));
    const ids: number[] = [];
    for (const sha of shas) {
      const photo = bySha.get(sha);
      if (photo) ids.push(photo.id);
    }
    if (ids.length > 0) this.removePhotos(ids);
    for (const sha of shas) {
      // Submitted directly, never through the mark guard: the optimistic removal above has
      // already taken the row out of `photos`, and a delete of an unknown sha is a server
      // no-op anyway — which is what makes the pending tombstone work.
      if (bySha.has(sha)) void this.submit({ type: 'delete', targetSha: sha });
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
    void this.feedbackRows.remove(id, this.contentLocale, () => deleteFeedback(id));
  }

  /** Manual (root-only) display order. Rows seen on /admin always carry real ids, so the
   *  collection drops a temporary id from the request instead of waiting for one. */
  fbReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.feedbackRows.reorder(locale, orderedIds, (ids) => reorderFeedback(ids, locale));
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
