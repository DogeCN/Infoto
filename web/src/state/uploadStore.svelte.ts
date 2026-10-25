import { onDestroy, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import { copy, fmt } from '$shared/copy';
import { extOfType } from '$shared/media';
import type { MediaType, Op, Photo, UploadPayload } from '$shared/types';
import { getLocale } from '$lib/i18n.svelte';
import { translateTaskError } from '$base/upload/pipeline';
import { UploadPipeline, type PipelineTaskSnapshot } from '../transcode/pipeline';
import { readArtifact } from '../transcode/opfs';
import {
  pendingMediaUrl,
  pendingPhoto,
  hostedPhotoCards,
  rendersCard,
  type UploadOverlay,
  samePendingPhoto,
  sameHostedCards,
  type HostedReadiness,
  type HostedPhotoFields,
} from '../core/pending';
import type { SyncEngine } from '../core/engine';
import type { PhotoRecord } from '../core/oplog';
import type { MarkSet } from '../core/ops';
import type { createAppStore } from './appStore.svelte';
import { setMediaHostSink, setPendingUploadCancelSink } from './appStore.svelte';

/** Album upload state, optimistic cards, progress, and preview resource ownership. */
export function createUploadStore(store: ReturnType<typeof createAppStore>, engine: SyncEngine) {
  let destroyed = false;
  const pipeline = new UploadPipeline({
    onEvent: import.meta.env.DEV ? (line) => console.log('[upload]', line) : undefined,
    // Append completed uploads to the sync engine without triggering an immediate snapshot. The
    // op and the photo's record are written in one transaction, so a hosted photo always has a
    // durable trace: the op the server will apply, and the record the page draws until it does.
    onUploadOp: async (op, artifact) => {
      const sha = uploadOpSha(op);
      // The card is gone — cancelled, dismissed, or its pending photo deleted. Writing the op
      // now would recreate the row the user just removed, after the tombstone that deleted it,
      // because /sync applies a batch in array order and a delete of an unknown sha is a no-op.
      if (sha && !hasTaskForSha(sha)) return;
      const record = sha ? hostedRecord(op, sha, artifact) : null;
      if (!record) return;
      await engine.addUploadOp(op, record);
      // Release the photo ops that were waiting for this row to exist.
      if (sha) await store.photoOpQueued(sha);
    },
    // Remove cancelled jobs locally and count their panel work as resolved.
    onJobRemoved: (jobId) => {
      if (uploadTasks.has(jobId)) countResolved(jobId);
      dropTask(jobId);
    },
    // Files outside the accept surface (often empty MIME on Windows) — visible notice
    onRejected: (fileName) =>
      toast.error(fmt(copy.upload.unknownType, { fileName }), {
        description: copy.upload.acceptHint,
      }),
  });

  let uploadTasks = $state<Map<string, PipelineTaskSnapshot>>(new Map());

  /** The sha an upload op carries, or null for any other op kind. */
  function uploadOpSha(op: Op): string | null {
    if (op.type !== 'upload') return null;
    const payload = op.payload as { sha256?: unknown } | null | undefined;
    return typeof payload?.sha256 === 'string' ? payload.sha256 : null;
  }

  /** Whether any tracked task still owns this sha (see the `onUploadOp` guard). */
  function hasTaskForSha(sha: string): boolean {
    for (const t of uploadTasks.values()) if (t.sha256 === sha) return true;
    return false;
  }

  /**
   * The record a hosted photo owns: everything the card renders that is not store state, so the
   * library survives a reload without the op log being read for rendering as well.
   */
  function hostedRecord(
    op: Op,
    sha256: string,
    artifact: { key: string; ext: 'webp' | 'webm' },
  ): PhotoRecord | null {
    const payload = (op.payload ?? {}) as Partial<UploadPayload>;
    const { url, width, height, size, type, createdAt } = payload;
    if (typeof url !== 'string' || !url) return null;
    if (typeof width !== 'number' || typeof height !== 'number' || typeof size !== 'number')
      return null;
    if (typeof type !== 'number' || typeof createdAt !== 'number' || createdAt === 0) return null;
    return {
      sha256,
      status: 'hosted',
      meta: { width, height, size, type: type as MediaType },
      artifact,
      url,
      createdAt,
      marks: store.pendingMarksFor(sha256),
    };
  }

  // /sync names the upload facade; the SharedWorker needs it before any job can upload.
  setMediaHostSink((url) => pipeline.setMediaHost(url));
  // Deleting a pending photo reaches here through the app store: cancel the job (stops an
  // in-flight transfer before it can write its upload op) and drop the card.
  setPendingUploadCancelSink((sha) => cancelPendingBySha(sha));

  /** Batch counters track observed jobs and count each resolved panel task once. */
  let batchTotal = $state(0);
  let batchDone = $state(0);
  const countedJobs = new Set<string>();
  const batchJobs = new Set<string>();
  function observeJob(jobId: string): void {
    if (batchJobs.has(jobId)) return;
    batchJobs.add(jobId);
    batchTotal += 1;
  }
  /** Count a job as resolved exactly once (terminal state, or a cancel). */
  function countResolved(jobId: string): void {
    if (countedJobs.has(jobId)) return;
    countedJobs.add(jobId);
    batchDone += 1;
  }

  /** Panel rows cover queueing, transcoding, and hashing; cards display the upload stage. */
  const PANEL_STAGES = new Set(['queued', 'lease-wait', 'transcoding', 'hashing']);
  const panelRows = $derived(
    Array.from(uploadTasks.values()).filter((t) => PANEL_STAGES.has(t.phase)),
  );

  /** The card's local preview: one object URL per job, owned by this store and released with
   *  the job. Read from the OPFS artifact — never from the picked file, which a card never
   *  needs (it appears only after stage 1) and which a GIF cannot even render, since its card
   *  is a `<video>`. */
  const previewUrls = new SvelteMap<string, string>();

  /**
   * Hosted copies already fetched into *this page*, per job. The upload's completion swaps the
   * card from the OPFS object URL to the hosted URL, and until the hosted bytes are here that
   * swap is a skeleton over a photo the user could already see. Preloading them in the page —
   * not in the SharedWorker, whose cache is not the renderer's — is what makes the handoff
   * seamless; the state also carries the URL so a retry cannot reuse a stale verdict.
   */
  const hostedReady = new SvelteMap<string, { url: string; state: HostedReadiness }>();

  /** Jobs whose hosted copy is being fetched right now (one attempt at a time). */
  const hostedReads = new Set<string>();

  /**
   * Fetch the hosted copy with the element that will render it. An `<img>` sends the same
   * `Accept` an image request sends, so it primes the exact cache entry the card looks up;
   * a video stops at its first decoded frame rather than downloading the whole file.
   */
  function ensureHostedReady(jobId: string, url: string, type: number | undefined): void {
    if (hostedReady.get(jobId)?.url === url || hostedReads.has(jobId)) return;
    hostedReads.add(jobId);
    hostedReady.set(jobId, { url, state: 'pending' });
    const settle = (state: HostedReadiness): void => {
      hostedReads.delete(jobId);
      if (destroyed || !uploadTasks.has(jobId)) return;
      hostedReady.set(jobId, { url, state });
    };
    if (type === 0) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => settle('ready');
      img.onerror = () => settle('failed');
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.onloadeddata = () => settle('ready');
    video.onerror = () => settle('failed');
    video.src = url;
  }

  /** Jobs whose artifact is being read right now; the guard that keeps it to one read. */
  const previewReads = new Set<string>();
  /** Read a job's OPFS artifact into its card preview (the only preview source). */
  async function ensureArtifactPreview(jobId: string, type: number): Promise<void> {
    if (previewUrls.has(jobId) || previewReads.has(jobId)) return;
    previewReads.add(jobId);
    try {
      const blob = await readArtifact(jobId, extOfType(type));
      // Discard previews for completed, cancelled, or destroyed jobs. `previewReads` holds this
      // job for the whole read, so no concurrent call can have published one in the meantime.
      if (!destroyed && blob && uploadTasks.has(jobId)) {
        previewUrls.set(jobId, URL.createObjectURL(blob));
      }
    } catch {
      /* an unreadable artifact just leaves the skeleton */
    } finally {
      previewReads.delete(jobId);
    }
  }

  /** Drop a task and its optimistic-card mapping (idempotent; used by cancel + cleanup). */
  function dropTask(jobId: string) {
    const id = tempIdByJob.get(jobId);
    if (id !== undefined) {
      tempIdByJob.delete(jobId);
      jobByTempId.delete(id);
    }
    tempCreatedAt.delete(jobId);
    photoCache.delete(jobId);
    hostedReady.delete(jobId);
    hostedReads.delete(jobId);
    const sha = uploadTasks.get(jobId)?.sha256;
    if (sha) store.forgetPendingPhoto(sha);
    const preview = previewUrls.get(jobId);
    if (preview) {
      URL.revokeObjectURL(preview);
      previewUrls.delete(jobId);
    }
    const next = new Map(uploadTasks);
    next.delete(jobId);
    uploadTasks = next;
  }

  // ---- Optimistic upload entries ----
  // Transcode done → insert at the top under a "curtain" mask that pulls up with
  // progress; failure → full mask + retry icon; /sync drops it by sha256 (server wins).
  let nextTempId = -1;
  const tempIdByJob = new Map<string, number>();
  const jobByTempId = new Map<number, string>();
  const photoCache = new Map<string, Photo>();
  // Guard against double-toasting the same failure within one session (e.g. a
  // redundant status echo). Replay across a page reload re-toasts intentionally:
  // a lingering failed upload deserves a fresh reminder.
  const toastedFailures = new Set<string>();
  const toastedDuplicates = new Set<string>();
  // A live job's card needs a timestamp that does not move on every progress tick. It is not
  // persisted: a hosted photo's own instant lives in its record, and a resumed job is a job that
  // is only now visible.
  const tempCreatedAt = new Map<string, number>();

  // ---- Cards the photo records state ----
  // The record is the client's own word about a photo the album does not have yet. The worker
  // writes it as `uploading`, the page turns it into `hosted` in the same transaction that
  // appends the upload op, and a confirmed sync deletes it. The card is a filter over those
  // records, so there is no second place a photo's existence could be read from and disagree.
  /** The projection, in upload order. */
  let hostedRecords = $state<HostedPhotoFields[]>([]);
  /** Temp ids for those cards, from the same counter as the live ones, so the two card sets can
   *  never collide in one selection. */
  const tempIdBySha = new Map<string, number>();
  /** `photoCache` key for a record-derived card, distinct from every jobId. */
  const hostedKey = (sha: string): string => `hosted:${sha}`;

  /**
   * Re-read the photo records. Called at page open and after a sync attempt finishes — a read of
   * durable state, never a sync trigger of its own (ADR 0008).
   */
  async function refreshHostedPhotos(): Promise<void> {
    if (destroyed) return;
    let records: PhotoRecord[];
    try {
      records = await engine.hostedPhotos();
    } catch {
      // An unreadable store leaves the cards on screen alone rather than emptying the grid.
      return;
    }
    const landed = new Set(store.photos.map((photo) => photo.sha256));
    const live = new Set<string>();
    for (const task of uploadTasks.values()) if (task.sha256) live.add(task.sha256);
    const next = hostedPhotoCards(records, { landed, live });
    // Marks on these photos are durable with them, so the store's own map is hydrated from the
    // same read: one owner, no localStorage copy to drift.
    const marks = new Map<string, MarkSet>();
    for (const record of records) if (record.marks) marks.set(record.sha256, record.marks);
    store.hydratePendingMarks(marks);
    for (const fields of next) {
      if (!tempIdBySha.has(fields.sha256)) tempIdBySha.set(fields.sha256, nextTempId--);
    }
    const keep = new Set(next.map((fields) => fields.sha256));
    for (const sha of [...tempIdBySha.keys()]) {
      if (keep.has(sha)) continue;
      tempIdBySha.delete(sha);
      photoCache.delete(hostedKey(sha));
    }
    // A re-read that changed nothing must not hand the layout a new array.
    if (!sameHostedCards(hostedRecords, next)) hostedRecords = next;
  }
  const pendingPhotos = $derived.by(() => {
    const out: Photo[] = [];
    // Sync-landed shas hide optimistic done/duplicate cards in the same render
    // cycle the real photo arrives — no one-frame double display while the
    // cleanup $effect is still scheduled.
    const landedShas = new Set(store.photos.map((p) => p.sha256));
    for (const t of uploadTasks.values()) {
      // Cards cover the upload stage, plus a failure that reached it (see `rendersCard`).
      if (!rendersCard(t)) continue;
      if (t.phase === 'done' && t.sha256 && landedShas.has(t.sha256)) continue;
      // tempId is assigned uniformly in the onTask callback; skip anything that
      // raced a dropTask (cancel / cleanup) instead of emitting id: undefined
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      // `rendersCard` only admits a failure that has an artifact, so every card has `meta`.
      if (!t.meta) continue;
      const meta = t.meta;
      const sha = t.sha256 ?? '';
      const marks = store.pendingMarksFor(sha);
      const hosted = t.url ?? '';
      const local = previewUrls.get(t.jobId) ?? '';
      const verdict = hosted ? hostedReady.get(t.jobId) : undefined;
      const readiness = verdict?.url === hosted ? verdict.state : undefined;
      const url = pendingMediaUrl(hosted, local, readiness);
      const createdAt = tempCreatedAt.get(t.jobId) ?? Date.now();
      const fields = {
        id,
        sha256: sha,
        url,
        uploader: store.selfId,
        width: meta.width,
        height: meta.height,
        size: meta.size,
        type: meta.type,
        createdAt,
        marks,
      };
      const cached = photoCache.get(t.jobId);
      if (cached && samePendingPhoto(cached, fields)) {
        out.push(cached);
      } else {
        const photo = pendingPhoto(fields);
        photoCache.set(t.jobId, photo);
        out.push(photo);
      }
    }
    // Photos the records state as hosted: the same card a `done` job leaves behind, still
    // awaiting the sync that turns it into a row. The guard mirrors the live `done` path, so
    // the moment the snapshot carries this sha the real photo takes the card's place.
    for (const q of hostedRecords) {
      if (landedShas.has(q.sha256)) continue;
      const id = tempIdBySha.get(q.sha256);
      if (id === undefined) continue;
      const fields = {
        id,
        sha256: q.sha256,
        url: q.url,
        uploader: store.selfId,
        width: q.width,
        height: q.height,
        size: q.size,
        type: q.type,
        // The upload instant the op carries, not "now": it is what orders the grid and it
        // survives the reload, unlike the live cards' session-scoped stamp.
        createdAt: q.createdAt,
        marks: store.pendingMarksFor(q.sha256),
      };
      const key = hostedKey(q.sha256);
      const cached = photoCache.get(key);
      if (cached && samePendingPhoto(cached, fields)) {
        out.push(cached);
      } else {
        const photo = pendingPhoto(fields);
        photoCache.set(key, photo);
        out.push(photo);
      }
    }
    return out;
  });

  const uploadOverlays = $derived.by(() => {
    getLocale();
    const m = new Map<number, UploadOverlay>();
    for (const t of uploadTasks.values()) {
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      if (t.phase === 'uploading') {
        // Once the host URL exists the curtain shows the real thing, not the local preview.
        if (t.meta) m.set(id, { fraction: t.fraction ?? 0, preview: !t.url });
      } else if (t.phase === 'failed') {
        // Failed jobs retain a retry overlay; the failure reason reaches the user through the
        // toast emitted for the same task, so the cover itself carries no text.
        m.set(id, { failed: true, preview: !t.url });
      }
      // done → no mask (curtain fully open, awaiting /sync correction)
    }
    return m;
  });

  // Remove duplicates and terminal jobs confirmed by a snapshot without subscribing cleanup writes.
  $effect(() => {
    const shas = new Set(store.photos.map((p) => p.sha256));
    const toDrop: string[] = [];
    for (const t of uploadTasks.values()) {
      if (t.phase !== 'done' && t.phase !== 'duplicate') continue;
      if (t.phase === 'duplicate' || (t.sha256 && shas.has(t.sha256))) {
        toDrop.push(t.jobId);
      }
    }
    untrack(() => {
      for (const jobId of toDrop) dropTask(jobId);
    });
  });

  function handleRetryUpload(photo: Photo) {
    const jobId = jobByTempId.get(photo.id);
    if (!jobId) return;
    // A retry is a fresh attempt: allow its failure to toast again, otherwise the
    // dedupe set would swallow it and the second failure would look like nothing happened.
    toastedFailures.delete(jobId);
    pipeline.retry(jobId);
  }

  /** Dismiss a failed card: cancel on the SW (stops refresh replay) + drop locally. */
  function handleDismissUpload(photo: Photo) {
    const jobId = jobByTempId.get(photo.id);
    if (!jobId) return;
    pipeline.cancel(jobId);
    dropTask(jobId);
  }

  /**
   * Drop every pending card for a sha the user deleted: cancel the job — the SharedWorker
   * drops its record and the OPFS artifact, and a transfer still in flight is aborted before
   * it can write its upload op — and drop the card locally even when the worker no longer
   * holds the record. Same shape as the failed-card dismiss.
   */
  function cancelPendingBySha(sha: string): void {
    for (const t of [...uploadTasks.values()]) {
      if (t.sha256 !== sha) continue;
      pipeline.cancel(t.jobId);
      dropTask(t.jobId);
    }
    // A record-derived card has no job to cancel, and the record itself is deleted by the app
    // store's withdrawal (which also files the tombstone). This only takes the card and its
    // in-memory state off screen in the same click.
    if (!tempIdBySha.has(sha)) return;
    tempIdBySha.delete(sha);
    photoCache.delete(hostedKey(sha));
    hostedRecords = hostedRecords.filter((fields) => fields.sha256 !== sha);
    store.forgetPendingPhoto(sha);
  }

  // Task sink lives in its own effect so its unsubscribe is honoured on teardown.
  // (Inside the guarded init effect above it would be torn down by the second run
  // that the `initialized` write triggers.)
  $effect(() =>
    pipeline.onTask((t) => {
      observeJob(t.jobId);
      // Count panel work as resolved when the task moves to a card or terminates.
      if (!PANEL_STAGES.has(t.phase)) countResolved(t.jobId);
      // Card preview is the artifact on disk: `meta` only exists once stage 1 wrote it, so it
      // is the exact signal that a preview can be read. This is also what gives a replayed job
      // (`replayJobs`) its image back after a reload, when the picked file is long gone.
      if (t.meta) void ensureArtifactPreview(t.jobId, t.meta.type);
      // The hosted copy is fetched here, in the page that will paint it, so the swap away
      // from the local preview lands on a warm cache instead of a skeleton.
      if (t.url) ensureHostedReady(t.jobId, t.url, t.meta?.type);
      // Drop confirmed terminal echoes without recreating optimistic cards.
      if (
        (t.phase === 'done' || t.phase === 'duplicate') &&
        t.sha256 &&
        store.photos.some((p) => p.sha256 === t.sha256)
      ) {
        if (t.phase === 'duplicate' && t.fileName && !toastedDuplicates.has(t.jobId)) {
          toastedDuplicates.add(t.jobId);
          toast.info(fmt(copy.upload.duplicate, { fileName: t.fileName }));
        }
        if (uploadTasks.has(t.jobId)) dropTask(t.jobId);
        return;
      }
      // Duplicate against a sha not (yet) in the store: brief panel row, toast, and
      // the cleanup effect drops it — no silent nothing, no lingering row.
      if (t.phase === 'duplicate' && t.fileName && !toastedDuplicates.has(t.jobId)) {
        toastedDuplicates.add(t.jobId);
        toast.info(fmt(copy.upload.duplicate, { fileName: t.fileName }));
      }
      // Album upload failure: surface a toast so the user notices even if the
      // failure card scrolled out of view. Editor failures have inline UI.
      if (t.phase === 'failed' && t.purpose === 'album' && !toastedFailures.has(t.jobId)) {
        toastedFailures.add(t.jobId);
        toast.error(
          fmt(copy.upload.failed, { fileName: t.fileName || copy.upload.defaultFileName }),
          {
            description: translateTaskError(t.error, { uploadLeg: !!t.sha256 }),
          },
        );
      }
      // Optimistic tempIds are assigned here — both pendingPhotos and uploadOverlays
      // deriveds read them; callbacks run before any derived evaluates, so order is safe.
      // The condition mirrors `pendingPhotos`, so a job that renders no card takes no id.
      if (rendersCard(t) && !tempIdByJob.has(t.jobId)) {
        const id = nextTempId--;
        tempIdByJob.set(t.jobId, id);
        jobByTempId.set(id, t.jobId);
        if (!tempCreatedAt.has(t.jobId)) tempCreatedAt.set(t.jobId, Date.now());
      }
      uploadTasks = new Map(uploadTasks.set(t.jobId, t));
    }),
  );

  function addFiles(files: FileList | File[]): void {
    // A pick while nothing is in flight starts a fresh batch — the counter describes one
    // batch, not the session.
    const inFlight = Array.from(uploadTasks.values()).some(
      (t) => t.phase !== 'done' && t.phase !== 'duplicate' && t.phase !== 'failed',
    );
    if (!inFlight) {
      batchTotal = 0;
      batchDone = 0;
      countedJobs.clear();
      batchJobs.clear();
      toastedFailures.clear();
      toastedDuplicates.clear();
    }
    // Nothing is seeded per pick: a card appears only after stage 1, so its preview and its
    // dimensions both come from the artifact (`ensureArtifactPreview` and the task's `meta`).
    pipeline.addFiles(files);
  }

  // The cards a previous page left hosted, read once at page open, and re-read when a sync
  // attempt finishes — a sync is what deletes a confirmed photo's record, so that is the only
  // other moment the set can change. A newly appended op always has a live card of its own, so
  // an append is deliberately not read back. Neither call is a sync trigger (ADR 0008).
  void refreshHostedPhotos();
  let wasSyncing = engine.state.syncing;
  const unsubscribeQueued = engine.onState((state) => {
    if (wasSyncing && !state.syncing) void refreshHostedPhotos();
    wasSyncing = state.syncing;
  });

  onDestroy(() => {
    destroyed = true;
    unsubscribeQueued();
    pipeline.stop();
    for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    previewUrls.clear();
  });

  return {
    start: () => pipeline.start(),
    addFiles,
    cancel: (jobId: string) => pipeline.cancel(jobId),
    retry: handleRetryUpload,
    dismiss: handleDismissUpload,
    get pendingPhotos() {
      return pendingPhotos;
    },
    get overlays() {
      return uploadOverlays;
    },
    get panelRows() {
      return panelRows;
    },
    get progress() {
      return { done: batchDone, total: batchTotal };
    },
  };
}
