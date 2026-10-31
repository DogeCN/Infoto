// Svelte 5 runes store: binds the Svelte-free core (engine / oplog / ops) to reactive
// state. Every write goes op-log → sync frame: mutate local state optimistically, append
// the op, let the engine flush.

import type {
  Announcement,
  AppliedOp,
  Feedback,
  LocaleCode,
  Op,
  Photo,
  Poll,
  SyncResponse,
  Vote,
} from '$shared/types';
import { activeLocale, copy, type Copy } from '$shared/copy';
import type { EngineState, SyncEngine, SyncSnapshotContext } from '../core/engine';
import { toast } from 'svelte-sonner';
import * as ops from '../core/ops';

/** Allocate descending temporary IDs for optimistic announcements and feedback. */
let nextTempId = -1;
const takeTempId = (): number => nextTempId--;

/** Toast text for one refused admin op, shared by every resource and action. The refusal
 *  reason rides the api subtree (the one dynamically-read copy section). */
interface AdminToasts {
  createFailed: string;
  updateFailed: string;
  deleteFailed: string;
  reorderFailed: string;
}

/**
 * One admin-managed collection's optimistic write path over WebSocket ops (ADR 0026).
 *
 * Announcements and polls differ only in their reducers, op shapes and toast text, so the
 * lifecycle lives here once: allocate a temporary id, apply the optimistic row, queue the
 * op under its client nonce, and resolve or roll back when the server echoes (or refuses)
 * that nonce. A reorder that still references a temporary id defers until the echo
 * assigns the real one.
 */
class AdminCollection<T extends { id: number; sort: number; locale: LocaleCode }> {
  private tempIds = new Map<number, number>();
  private pendingReorder: {
    locale: LocaleCode;
    ids: number[];
    previousIds: number[];
    commit: (ids: number[], cid: string) => Op;
  } | null = null;

  constructor(
    private config: {
      /** One locale's rows, read through a getter so the store owns the reactive buckets. */
      rows: (locale: LocaleCode) => T[];
      /** Replace one locale's rows with a pure reducer's result. Writes are addressed by
       *  locale, so an op that resolves after a language switch still lands in the
       *  language it was made for. */
      setRows: (locale: LocaleCode, rows: T[]) => void;
      toasts: AdminToasts;
      /** Whether a reorder may name a temporary id. Announcements and polls can — a create
       *  may still be in flight — and the submit waits for the real id. Feedback rows on
       *  /admin always carry real ids; an optimistic `fb_create` has no id mapping, so a
       *  negative id is dropped from the request instead of parking the reorder forever. */
      resolvesTempIds?: boolean;
      /** The store's ack registry: per-nonce confirm/rollback, fired by the engine's
       *  own-echo and drop notices. */
      register: (
        cid: string,
        handlers: { confirm: (applied: AppliedOp) => void; rollback: () => void },
      ) => void;
      unregister: (cid: string) => void;
      /** Queue one op (the store's submit). */
      commit: (op: Op) => void;
      /** The refusal copy for a dropped op, keyed by action (read dynamically: the api
       *  subtree is the one place a message is picked by a value, not a chain). */
      apiError: (action: 'create' | 'update' | 'delete' | 'reorder') => string;
    },
  ) {}

  /** Insert an optimistic row under `tempId`; the op's echo assigns the real id. */
  create(
    tempId: number,
    locale: LocaleCode,
    optimistic: (rows: T[]) => T[],
    buildOp: (cid: string) => Op,
  ): void {
    const cid = crypto.randomUUID();
    this.config.setRows(locale, optimistic(this.config.rows(locale)));
    this.config.register(cid, {
      confirm: (applied) => {
        const id = recordId(applied.op);
        if (id === null) return;
        this.tempIds.set(tempId, id);
        this.config.setRows(
          locale,
          this.config.rows(locale).map((row) => (row.id === tempId ? { ...row, id } : row)),
        );
        this.flushPendingReorder();
      },
      rollback: () => {
        console.error('[admin] create dropped');
        this.config.setRows(
          locale,
          this.config.rows(locale).filter((row) => row.id !== tempId),
        );
        if (this.pendingReorder?.ids.includes(tempId)) this.pendingReorder = null;
        toast.error(this.config.toasts.createFailed, {
          description: this.config.apiError('create'),
        });
      },
    });
    this.config.commit(buildOp(cid));
  }

  /** Apply an edit and restore the edited row only, never the whole list. */
  update(
    id: number,
    locale: LocaleCode,
    optimistic: (rows: T[]) => T[],
    buildOp: (cid: string) => Op,
  ): void {
    const previous = this.config.rows(locale).find((row) => row.id === id);
    const cid = crypto.randomUUID();
    this.config.setRows(locale, optimistic(this.config.rows(locale)));
    this.config.register(cid, {
      confirm: () => {},
      rollback: () => {
        console.error('[admin] update dropped');
        // Restore only the edited row: a broadcast may have landed meanwhile, and a
        // whole-array rollback would discard those unrelated changes.
        if (previous) {
          this.config.setRows(
            locale,
            this.config.rows(locale).map((row) => (row.id === id ? previous : row)),
          );
        }
        toast.error(this.config.toasts.updateFailed, {
          description: this.config.apiError('update'),
        });
      },
    });
    this.config.commit(buildOp(cid));
  }

  /** Remove a row and put it back at its prior position unless a snapshot restored it. */
  remove(id: number, locale: LocaleCode, buildOp: (cid: string) => Op): void {
    const rows = this.config.rows(locale);
    const index = rows.findIndex((row) => row.id === id);
    const previous = index >= 0 ? rows[index] : undefined;
    const cid = crypto.randomUUID();
    this.config.setRows(
      locale,
      rows.filter((row) => row.id !== id),
    );
    this.config.register(cid, {
      confirm: () => {},
      rollback: () => {
        console.error('[admin] delete dropped');
        if (previous && !this.config.rows(locale).some((row) => row.id === id)) {
          const next = [...this.config.rows(locale)];
          next.splice(Math.min(index, next.length), 0, previous);
          this.config.setRows(locale, next);
        }
        toast.error(this.config.toasts.deleteFailed, {
          description: this.config.apiError('delete'),
        });
      },
    });
    this.config.commit(buildOp(cid));
  }

  /** Reorder one locale at once; a still-temporary id defers the submit until it resolves. */
  reorder(
    locale: LocaleCode,
    orderedIds: number[],
    buildOp: (ids: number[], cid: string) => Op,
  ): void {
    const previousIds = this.config.rows(locale).map((row) => row.id);
    this.config.setRows(locale, ops.applyReorder(this.config.rows(locale), orderedIds));
    const resolved = this.resolveIds(orderedIds);
    if (this.config.resolvesTempIds === false) {
      this.submitReorder(
        resolved.filter((id) => id > 0),
        previousIds,
        locale,
        buildOp,
      );
      return;
    }
    if (resolved.every((id) => id > 0)) {
      this.submitReorder(resolved, previousIds, locale, buildOp);
      return;
    }
    // A just-created row still carries a temp id: keep the new order locally —
    // no "can't reorder yet" deadlock — and flush when the real id arrives.
    this.pendingReorder = { locale, ids: orderedIds, previousIds, commit: buildOp };
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
    this.submitReorder(resolved, pending.previousIds, pending.locale, pending.commit);
  }

  private submitReorder(
    ids: number[],
    previousIds: number[],
    locale: LocaleCode,
    buildOp: (ids: number[], cid: string) => Op,
  ): void {
    const cid = crypto.randomUUID();
    this.config.register(cid, {
      confirm: () => {},
      rollback: () => {
        console.error('[admin] reorder dropped');
        this.config.setRows(locale, ops.applyReorder(this.config.rows(locale), previousIds));
        toast.error(this.config.toasts.reorderFailed, {
          description: this.config.apiError('reorder'),
        });
      },
    });
    this.config.commit(buildOp(ids, cid));
  }
}

/** The server stamps an assigned id into a create op's payload before broadcasting it. */
function recordId(op: Op): number | null {
  const id = (op.payload as Record<string, unknown> | null | undefined)?.['id'];
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Cache the public self ID for initial rendering; authenticated snapshots replace it. */
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
  engineState = $state<EngineState>({ syncing: false, pending: 0, connected: false });
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
  /** Upload facade from the last welcome / synced frame. */
  mediaHostUrl = $state<string>('');

  private engineUnsubscribe: (() => void) | null = null;

  /** Per-nonce confirm/rollback for ops this tab originated, routed by the engine. */
  private ackHandlers = new Map<
    string,
    { confirm: (applied: AppliedOp) => void; rollback: () => void }
  >();

  private registerAck(
    cid: string,
    handlers: { confirm: (applied: AppliedOp) => void; rollback: () => void },
  ): void {
    this.ackHandlers.set(cid, handlers);
  }

  private unregisterAck(cid: string): void {
    this.ackHandlers.delete(cid);
  }

  private commitOp(op: Op): void {
    void this.submit(op);
  }

  /** Ops the server broadcast that this tab did not originate: applied live, per type. */
  applyServerOps(applied: AppliedOp[]): void {
    for (const a of applied) {
      try {
        this.applyServerOp(a);
      } catch (e) {
        console.error('[sync] apply op failed', a.op.type, e);
      }
    }
  }

  /** This tab's own echo: the optimistic state is already on screen; a create learns its
   *  server-assigned id here, and the ack bookkeeping closes out. */
  onOwnEcho(applied: AppliedOp): void {
    if (!applied.cid) return;
    const handlers = this.ackHandlers.get(applied.cid);
    if (!handlers) return;
    this.ackHandlers.delete(applied.cid);
    handlers.confirm(applied);
  }

  /** The server refused one of this tab's ops: roll the optimistic state back. */
  onOpDropped(cid: string): void {
    const handlers = this.ackHandlers.get(cid);
    if (!handlers) return;
    this.ackHandlers.delete(cid);
    handlers.rollback();
  }

  private announcementRows = new AdminCollection<Announcement>({
    rows: (locale) => localeSlice(this.allAnnouncements, locale),
    setRows: (locale, rows) => {
      this.allAnnouncements = replaceLocale(this.allAnnouncements, locale, rows);
    },
    register: (cid, handlers) => this.registerAck(cid, handlers),
    unregister: (cid) => this.unregisterAck(cid),
    commit: (op) => this.commitOp(op),
    apiError: (action) => {
      const key = {
        create: 'announcementCreateFailed',
        update: 'announcementUpdateFailed',
        delete: 'announcementDeleteFailed',
        reorder: 'announcementReorderFailed',
      }[action] as keyof Copy['api'];
      return copy.api[key];
    },
    toasts: {
      createFailed: copy.admin.announcement.publishFailed,
      updateFailed: copy.admin.announcement.saveFailed,
      deleteFailed: copy.admin.announcement.deleteFailed,
      reorderFailed: copy.admin.announcement.reorderFailed,
    },
  });

  private pollRows = new AdminCollection<Poll>({
    rows: (locale) => localeSlice(this.allPolls, locale),
    setRows: (locale, rows) => {
      this.allPolls = replaceLocale(this.allPolls, locale, rows);
    },
    register: (cid, handlers) => this.registerAck(cid, handlers),
    unregister: (cid) => this.unregisterAck(cid),
    commit: (op) => this.commitOp(op),
    apiError: (action) => {
      const key = {
        create: 'pollCreateFailed',
        update: 'pollUpdateFailed',
        delete: 'pollDeleteFailed',
        reorder: 'pollReorderFailed',
      }[action] as keyof Copy['api'];
      return copy.api[key];
    },
    toasts: {
      createFailed: copy.admin.poll.publishFailed,
      updateFailed: copy.admin.poll.saveFailed,
      deleteFailed: copy.admin.poll.deleteFailed,
      reorderFailed: copy.admin.poll.reorderFailed,
    },
  });

  private feedbackRows = new AdminCollection<Feedback>({
    rows: (locale) => localeSlice(this.allFeedback, locale),
    setRows: (locale, rows) => {
      this.allFeedback = replaceLocale(this.allFeedback, locale, rows);
    },
    register: (cid, handlers) => this.registerAck(cid, handlers),
    unregister: (cid) => this.unregisterAck(cid),
    commit: (op) => this.commitOp(op),
    apiError: (action) => {
      const key = { delete: 'feedbackDeleteFailed', reorder: 'feedbackReorderFailed' }[
        action as 'delete' | 'reorder'
      ] as keyof Copy['api'];
      return copy.api[key];
    },
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
  pendingMarks = $state<Map<string, ops.MarkSet>>(new Map());

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

  // Server-broadcast application (foreign ops, and catch-up replays)

  /** Fold one server-applied op into this tab's state. Every branch mirrors the
   *  Durable Object's applier (worker/album-ops.ts) so both sides compute the same
   *  state from the same op. */
  private applyServerOp(a: AppliedOp): void {
    const op = a.op;
    const actor = a.actor;
    switch (op.type) {
      case 'upload': {
        const p = (op.payload ?? {}) as Record<string, unknown>;
        const sha256 = typeof p.sha256 === 'string' ? p.sha256 : null;
        const url = typeof p.url === 'string' ? p.url : null;
        const id = typeof p.id === 'number' ? p.id : null;
        if (!sha256 || !url || id === null) return;
        if (this.photos.some((photo) => photo.sha256 === sha256)) return;
        const type = (p.type === 0 || p.type === 1 || p.type === 2 ? p.type : 0) as Photo['type'];
        this.photos = [
          ...this.photos,
          {
            id,
            sha256,
            url,
            uploader: actor,
            width: typeof p.width === 'number' ? p.width : 0,
            height: typeof p.height === 'number' ? p.height : 0,
            size: typeof p.size === 'number' ? p.size : 0,
            createdAt: typeof p.createdAt === 'number' ? Math.min(p.createdAt, a.ts) : a.ts,
            type,
            likes: [],
            dislikes: [],
            reports: [],
          },
        ];
        return;
      }
      case 'like':
      case 'unlike':
      case 'dislike':
      case 'undislike':
      case 'report':
      case 'unreport': {
        if (!op.targetSha) return;
        const row = this.photos.find((p) => p.sha256 === op.targetSha);
        if (!row) return;
        const spec = ops.markOpSpec(op.type);
        if (!spec) return;
        this.photos = ops.applyMark(this.photos, row.id, spec.kind, actor, spec.add);
        return;
      }
      case 'delete': {
        if (!op.targetSha) return;
        const row = this.photos.find((p) => p.sha256 === op.targetSha);
        if (!row) return;
        this.photos = ops.applyDelete(this.photos, [row.id]);
        return;
      }
      case 'vote': {
        const options = (op.payload as { options?: number[] } | null)?.options;
        if (op.target == null || !Array.isArray(options)) return;
        this.allPolls = ops.applyVote(this.allPolls, op.target, actor, options);
        return;
      }
      case 'react': {
        const emoji = (op.payload as { emoji?: string | null } | null)?.emoji ?? null;
        if (op.target == null) return;
        this.allAnnouncements = ops.applyReact(this.allAnnouncements, op.target, actor, emoji);
        return;
      }
      case 'fb_create': {
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const contentMd = typeof payload.contentMd === 'string' ? payload.contentMd : null;
        const locale = (payload.locale as LocaleCode | undefined) ?? null;
        const id = typeof payload.id === 'number' ? payload.id : null;
        if (!contentMd || !locale || id === null || this.selfId !== 0) return;
        if (this.allFeedback.some((f) => f.id === id)) return;
        const createdAt = typeof op.ct === 'number' && op.ct > 0 ? Math.min(op.ct, a.ts) : a.ts;
        const sorts = this.allFeedback.filter((f) => f.locale === locale).map((f) => f.sort);
        const sort = sorts.length > 0 ? Math.min(...sorts) - 1 : 0;
        this.allFeedback = [
          { id, userId: actor, contentMd, createdAt, locale, sort },
          ...this.allFeedback,
        ];
        return;
      }
      case 'fb_delete': {
        if (op.target == null) return;
        this.allFeedback = this.allFeedback.filter((f) => f.id !== op.target);
        return;
      }
      case 'fb_reorder': {
        const ids = (op.payload as { ids?: number[] } | null)?.ids;
        if (!Array.isArray(ids)) return;
        const locale = (op.payload as { locale?: LocaleCode } | null)?.locale;
        if (!locale) return;
        const inLocale = this.allFeedback.filter((f) => f.locale === locale);
        const ordered = ops.applyReorder(inLocale, ids);
        const byId = new Map(ordered.map((f) => [f.id, f]));
        this.allFeedback = this.allFeedback.map((f) => byId.get(f.id) ?? f);
        return;
      }
      case 'ann_create': {
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const title = typeof payload.title === 'string' ? payload.title : null;
        const contentMd = typeof payload.contentMd === 'string' ? payload.contentMd : null;
        const locale = (payload.locale as LocaleCode | undefined) ?? null;
        const id = typeof payload.id === 'number' ? payload.id : null;
        if (!title || !contentMd || !locale || id === null) return;
        if (this.allAnnouncements.some((x) => x.id === id)) return;
        const sorts = this.allAnnouncements.filter((x) => x.locale === locale).map((x) => x.sort);
        const sort = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
        this.allAnnouncements = [
          ...this.allAnnouncements,
          { id, title, contentMd, locale, sort, updatedAt: a.ts, reactions: [] },
        ];
        return;
      }
      case 'ann_update': {
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const title = typeof payload.title === 'string' ? payload.title : null;
        const contentMd = typeof payload.contentMd === 'string' ? payload.contentMd : null;
        const locale = (payload.locale as LocaleCode | undefined) ?? null;
        if (op.target == null || !title || !contentMd || !locale) return;
        const row = this.allAnnouncements.find((x) => x.id === op.target);
        if (!row) return;
        const sorts = this.allAnnouncements
          .filter((x) => x.locale === locale && x.id !== op.target)
          .map((x) => x.sort);
        const sort = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
        this.allAnnouncements = this.allAnnouncements.map((x) =>
          x.id === op.target ? { ...x, title, contentMd, locale, sort, updatedAt: a.ts } : x,
        );
        return;
      }
      case 'ann_delete': {
        if (op.target == null) return;
        this.allAnnouncements = this.allAnnouncements.filter((x) => x.id !== op.target);
        return;
      }
      case 'ann_reorder': {
        const ids = (op.payload as { ids?: number[] } | null)?.ids;
        const locale = (op.payload as { locale?: LocaleCode } | null)?.locale;
        if (!Array.isArray(ids) || !locale) return;
        const inLocale = this.allAnnouncements.filter((x) => x.locale === locale);
        const ordered = ops.applyReorder(inLocale, ids);
        const byId = new Map(ordered.map((x) => [x.id, x]));
        this.allAnnouncements = this.allAnnouncements.map((x) => byId.get(x.id) ?? x);
        return;
      }
      case 'poll_create': {
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const id = typeof payload.id === 'number' ? payload.id : null;
        const locale = (payload.locale as LocaleCode | undefined) ?? null;
        const options = Array.isArray(payload.options)
          ? (payload.options as unknown[]).filter((o): o is string => typeof o === 'string')
          : null;
        if (id === null || !locale || options === null) return;
        if (typeof payload.allowMultiple !== 'boolean') return;
        if (this.allPolls.some((p) => p.id === id)) return;
        const sorts = this.allPolls.filter((p) => p.locale === locale).map((p) => p.sort);
        const sort = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
        this.allPolls = [
          ...this.allPolls,
          {
            id,
            options,
            allowMultiple: payload.allowMultiple,
            locale,
            sort,
            updatedAt: a.ts,
            votes: [],
          },
        ];
        return;
      }
      case 'poll_update': {
        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const options = Array.isArray(payload.options)
          ? (payload.options as unknown[]).filter((o): o is string => typeof o === 'string')
          : null;
        const votes = Array.isArray(payload.votes) ? (payload.votes as Vote[]) : null;
        const locale = (payload.locale as LocaleCode | undefined) ?? null;
        if (op.target == null || options === null || votes === null || !locale) return;
        if (typeof payload.allowMultiple !== 'boolean') return;
        const allowMultiple: boolean = payload.allowMultiple;
        const row = this.allPolls.find((p) => p.id === op.target);
        if (!row) return;
        const sorts = this.allPolls
          .filter((p) => p.locale === locale && p.id !== op.target)
          .map((p) => p.sort);
        const sort = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
        this.allPolls = this.allPolls.map((p) =>
          p.id === op.target
            ? {
                ...p,
                options,
                allowMultiple,
                locale,
                sort,
                updatedAt: a.ts,
                votes,
              }
            : p,
        );
        return;
      }
      case 'poll_delete': {
        if (op.target == null) return;
        this.allPolls = this.allPolls.filter((p) => p.id !== op.target);
        return;
      }
      case 'poll_reorder': {
        const ids = (op.payload as { ids?: number[] } | null)?.ids;
        const locale = (op.payload as { locale?: LocaleCode } | null)?.locale;
        if (!Array.isArray(ids) || !locale) return;
        const inLocale = this.allPolls.filter((p) => p.locale === locale);
        const ordered = ops.applyReorder(inLocale, ids);
        const byId = new Map(ordered.map((p) => [p.id, p]));
        this.allPolls = this.allPolls.map((p) => byId.get(p.id) ?? p);
        return;
      }
      default:
        return;
    }
  }

  // Photos

  /**
   * Submit one mark, dropping it while the row it targets does not exist yet. Marks are the
   * ops that *need* the row: a photo op is addressed by sha256 and /sync applies a batch in
   * array order, so a mark sent before its upload is a no-op on an unknown sha (its own
   * `WHERE sha256 = ?` matches no row) and is then cleared as confirmed — the mark would be
   * lost. The mark itself is already recorded in `pendingMarks`, and `photoOpQueued` states it
   * as an op once the row exists.
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
  private async withdrawPendingUpload(shas: readonly string[]): Promise<void> {
    // The cards go regardless — a failed transcode carries no sha and still has a card.
    for (const sha of shas) cancelPendingUpload(sha);
    if (!this.engine) return;
    // One transaction for the whole selection: the record, its mark ops and the upload op each
    // record owns.
    await this.engine.withdrawPhotos(shas);
    for (const sha of shas) await this.submit({ type: 'delete', targetSha: sha });
  }

  /** Keep the map when nothing changed: the cards compare mark arrays by reference, and a new
   *  Map on every read re-keys every marked card. */
  private sameMarks(next: Map<string, ops.MarkSet>): boolean {
    if (next.size !== this.pendingMarks.size) return false;
    for (const [sha, marks] of next) {
      const current = this.pendingMarks.get(sha);
      if (current !== marks) return false;
    }
    return true;
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

  /** Apply one mark to a pending card and replace the map entry, writing it through to the
   *  photo's record so the mark cannot outlive the photo it belongs to. */
  private setPendingMark(sha256: string, kind: ops.MarkKind, add: boolean): void {
    const cur = this.pendingMarks.get(sha256) ?? ops.EMPTY_MARKS;
    const set = ops.applyMarkToSet(cur, kind, this.selfId, add);
    this.pendingMarks = new Map(this.pendingMarks.set(sha256, set));
    void this.engine?.updatePhotoMarks(sha256, set).catch((e) => console.warn('[mark]', e));
  }

  /** Replace the mark map from the photo records, which are the durable owner. Called by the
   *  upload store after it reads them; a mark survives a reload this way and nowhere else. */
  hydratePendingMarks(marks: Map<string, ops.MarkSet>): void {
    if (this.sameMarks(marks)) return;
    this.pendingMarks = marks;
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
    const pending = shas.filter((sha) => !bySha.has(sha));
    for (const sha of shas) {
      // Submitted directly, never through the mark guard: the optimistic removal above has
      // already taken the row out of `photos`, and a delete of an unknown sha is a server
      // no-op anyway — which is what makes the pending tombstone work.
      if (bySha.has(sha)) void this.submit({ type: 'delete', targetSha: sha });
    }
    void this.withdrawPendingUpload(pending);
  }

  // Announcements

  // Admin writes optimistically update one row and commit or roll it back after the response.
  // Every write carries this store's content locale, which is the same value the optimistic
  // row was filed under — never a second read of the UI locale.

  annCreate(title: string, contentMd: string): void {
    const locale = this.contentLocale;
    const tempId = takeTempId();
    this.announcementRows.create(
      tempId,
      locale,
      (rows) => ops.applyAnnCreate(rows, tempId, title, contentMd, locale, Date.now()),
      (cid) => ({ type: 'ann_create', payload: { title, contentMd, locale }, cid, ct: Date.now() }),
    );
  }

  annUpdate(id: number, title: string, contentMd: string): void {
    const locale = this.contentLocale;
    this.announcementRows.update(
      id,
      locale,
      (rows) => ops.applyAnnUpdate(rows, id, title, contentMd, Date.now()),
      (cid) => ({
        type: 'ann_update',
        target: id,
        payload: { title, contentMd, locale },
        cid,
        ct: Date.now(),
      }),
    );
  }

  annDelete(id: number): void {
    this.announcementRows.remove(id, this.contentLocale, (cid) => ({
      type: 'ann_delete',
      target: id,
      cid,
      ct: Date.now(),
    }));
  }

  annReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.announcementRows.reorder(locale, orderedIds, (ids, cid) => ({
      type: 'ann_reorder',
      payload: { locale, ids },
      cid,
      ct: Date.now(),
    }));
  }

  // Polls

  pollCreate(options: string[], allowMultiple: boolean): void {
    const locale = this.contentLocale;
    const tempId = takeTempId();
    this.pollRows.create(
      tempId,
      locale,
      (rows) => ops.applyPollCreate(rows, tempId, options, allowMultiple, locale, Date.now()),
      (cid) => ({
        type: 'poll_create',
        payload: { options, allowMultiple, locale },
        cid,
        ct: Date.now(),
      }),
    );
  }

  pollUpdate(id: number, options: string[], allowMultiple: boolean, votes: Vote[]): void {
    const locale = this.contentLocale;
    this.pollRows.update(
      id,
      locale,
      (rows) => ops.applyPollUpdate(rows, id, options, allowMultiple, votes, Date.now()),
      (cid) => ({
        type: 'poll_update',
        target: id,
        payload: { options, allowMultiple, locale, votes },
        cid,
        ct: Date.now(),
      }),
    );
  }

  pollDelete(id: number): void {
    this.pollRows.remove(id, this.contentLocale, (cid) => ({
      type: 'poll_delete',
      target: id,
      cid,
      ct: Date.now(),
    }));
  }

  pollReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.pollRows.reorder(locale, orderedIds, (ids, cid) => ({
      type: 'poll_reorder',
      payload: { locale, ids },
      cid,
      ct: Date.now(),
    }));
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
    const cid = crypto.randomUUID();
    // The echo assigns the real id; the optimistic temp row is replaced through it.
    this.registerAck(cid, {
      confirm: (applied) => {
        const id = recordId(applied.op);
        if (id === null) return;
        this.allFeedback = this.allFeedback.map((row) =>
          row.id === tempId ? { ...row, id } : row,
        );
      },
      rollback: () => {
        this.allFeedback = this.allFeedback.filter((row) => row.id !== tempId);
      },
    });
    void this.submit({ type: 'fb_create', payload: { contentMd, locale }, cid, ct: Date.now() });
  }

  fbDelete(id: number): void {
    this.feedbackRows.remove(id, this.contentLocale, (cid) => ({
      type: 'fb_delete',
      target: id,
      cid,
      ct: Date.now(),
    }));
  }

  /** Manual (root-only) display order. Rows seen on /admin always carry real ids, so the
   *  collection drops a temporary id from the request instead of waiting for one. */
  fbReorder(orderedIds: number[]): void {
    const locale = this.contentLocale;
    this.feedbackRows.reorder(locale, orderedIds, (ids, cid) => ({
      type: 'fb_reorder',
      payload: { locale, ids },
      cid,
      ct: Date.now(),
    }));
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
