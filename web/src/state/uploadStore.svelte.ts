import { onDestroy, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import { copy, fmt } from '$shared/copy';
import { extOfType } from '$shared/media';
import type { Photo } from '$shared/types';
import { getLocale } from '$lib/i18n.svelte';
import { translateTaskError } from '$base/upload/pipeline';
import { UploadPipeline, probeSourceSize, type PipelineTaskSnapshot } from '../transcode/pipeline';
import { readArtifact } from '../transcode/opfs';
import type { SyncEngine } from '../core/engine';
import type { createAppStore } from './appStore.svelte';
import { setMediaHostSink } from './appStore.svelte';

/** Album upload state, optimistic cards, progress, and preview resource ownership. */
export function createUploadStore(store: ReturnType<typeof createAppStore>, engine: SyncEngine) {
  let destroyed = false;
  const pipeline = new UploadPipeline({
    onEvent: (line) => console.log('[upload]', line),
    // Append completed uploads to the sync engine without triggering an immediate snapshot.
    onUploadOp: async (op) => {
      await engine.addOp(op);
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

  // /sync names the upload facade; the SharedWorker needs it before any job can upload.
  setMediaHostSink((url) => pipeline.setMediaHost(url));
  /** Source dimensions probed at enqueue — failed transcodes keep the real aspect ratio. */
  const probedSizeByJob = new SvelteMap<string, { width: number; height: number }>();

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

  /** Object URLs for transcoded OPFS previews, released when jobs leave or the store is destroyed. */
  const previewUrls = new SvelteMap<string, string>();

  /** Object URL for the OPFS artifact, once per job (no-op while the read is in flight). */
  const previewReads = new Set<string>();
  async function ensureArtifactPreview(jobId: string, type: number): Promise<void> {
    if (previewUrls.has(jobId) || previewReads.has(jobId)) return;
    previewReads.add(jobId);
    try {
      const blob = await readArtifact(jobId, extOfType(type));
      // Discard preview reads for completed, cancelled, or destroyed jobs.
      if (!destroyed && blob && uploadTasks.has(jobId) && !previewUrls.has(jobId)) {
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
    probedSizeByJob.delete(jobId);
    tempCreatedAt.delete(jobId);
    writeTempCreatedAt(tempCreatedAt);
    photoCache.delete(jobId);
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

  // Probes run sequentially (one decode at a time) so a 20-photo pick never
  // bursts the main thread with concurrent image decodes.
  let probeChain = Promise.resolve();
  function queueSizeProbe(jobId: string, file: File) {
    probeChain = probeChain
      .then(async () => {
        if (destroyed || !uploadTasks.has(jobId)) return;
        const size = await probeSourceSize(file);
        if (destroyed) return;
        if (size && uploadTasks.has(jobId)) probedSizeByJob.set(jobId, size);
      })
      .catch(() => undefined);
  }

  // ---- Optimistic upload entries ----
  // Transcode done → insert at the top under a "curtain" mask that pulls up with
  // progress; failure → full mask + retry icon; /sync drops it by sha256 (server wins).
  let nextTempId = -1;
  const tempIdByJob = new Map<string, number>();
  const jobByTempId = new Map<number, string>();
  const photoCache = new Map<string, Photo>();
  const EMPTY_MARKS: { likes: number[]; dislikes: number[]; reports: number[] } = {
    likes: [],
    dislikes: [],
    reports: [],
  };
  // Guard against double-toasting the same failure within one session (e.g. a
  // redundant status echo). Replay across a page reload re-toasts intentionally:
  // a lingering failed upload deserves a fresh reminder.
  const toastedFailures = new Set<string>();
  const toastedDuplicates = new Set<string>();
  const TEMP_CREATED_KEY = 'infoto-temp-created';
  const TEMP_CREATED_TTL_MS = 30 * 60 * 1000;

  function readTempCreatedAt(): Map<string, number> {
    try {
      const raw = sessionStorage.getItem(TEMP_CREATED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as [string, number][];
        const now = Date.now();
        const map = new Map<string, number>();
        for (const [jobId, ts] of parsed) {
          if (
            typeof jobId === 'string' &&
            typeof ts === 'number' &&
            Number.isFinite(ts) &&
            ts <= now &&
            now - ts < TEMP_CREATED_TTL_MS
          )
            map.set(jobId, ts);
        }
        return map;
      }
    } catch {
      /* noop */
    }
    return new Map();
  }

  function writeTempCreatedAt(map: Map<string, number>): void {
    try {
      sessionStorage.setItem(TEMP_CREATED_KEY, JSON.stringify([...map.entries()]));
    } catch {
      /* noop */
    }
  }

  // Stable optimistic timestamps preserve sort order across progress updates.
  const tempCreatedAt = new Map<string, number>(readTempCreatedAt());

  const pendingPhotos = $derived.by(() => {
    const out: Photo[] = [];
    // Sync-landed shas hide optimistic done/duplicate cards in the same render
    // cycle the real photo arrives — no one-frame double display while the
    // cleanup $effect is still scheduled.
    const landedShas = new Set(store.photos.map((p) => p.sha256));
    for (const t of uploadTasks.values()) {
      // Create optimistic cards for uploading, completed, and failed jobs.
      if (!['uploading', 'done', 'failed'].includes(t.phase)) continue;
      if (t.phase === 'done' && t.sha256 && landedShas.has(t.sha256)) continue;
      // tempId is assigned uniformly in the onTask callback; skip anything that
      // raced a dropTask (cancel / cleanup) instead of emitting id: undefined
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      // Failed transcodes have no meta: fall back to the probed source dimensions
      // so the failure card keeps the real aspect ratio (placeholder 800×600 only
      // when probing also failed)
      const probed = probedSizeByJob.get(t.jobId);
      const meta = t.meta ?? {
        width: probed?.width ?? 800,
        height: probed?.height ?? 600,
        size: 0,
        type: 0 as const,
      };
      const sha = t.sha256 ?? '';
      const marks = sha ? store.pendingMarksFor(sha) : EMPTY_MARKS;
      const url = t.url ?? previewUrls.get(t.jobId) ?? '';
      const createdAt = tempCreatedAt.get(t.jobId) ?? Date.now();
      const cached = photoCache.get(t.jobId);
      if (
        cached &&
        cached.id === id &&
        cached.sha256 === sha &&
        cached.url === url &&
        cached.uploader === store.selfId &&
        cached.width === meta.width &&
        cached.height === meta.height &&
        cached.size === meta.size &&
        cached.type === meta.type &&
        cached.createdAt === createdAt &&
        cached.likes === marks.likes &&
        cached.dislikes === marks.dislikes &&
        cached.reports === marks.reports
      ) {
        out.push(cached);
      } else {
        const photo: Photo = {
          id,
          sha256: sha,
          url,
          uploader: store.selfId,
          width: meta.width,
          height: meta.height,
          size: meta.size,
          createdAt,
          type: meta.type,
          likes: marks.likes,
          dislikes: marks.dislikes,
          reports: marks.reports,
        };
        photoCache.set(t.jobId, photo);
        out.push(photo);
      }
    }
    return out;
  });

  const uploadOverlays = $derived.by(() => {
    getLocale();
    const m = new Map<
      number,
      { fraction?: number; failed?: boolean; error?: string; preview?: boolean }
    >();
    for (const t of uploadTasks.values()) {
      const id = tempIdByJob.get(t.jobId);
      if (id === undefined) continue;
      if (t.phase === 'uploading') {
        // Once the host URL exists the curtain shows the real thing, not the local preview.
        if (t.meta) m.set(id, { fraction: t.fraction ?? 0, preview: !t.url });
      } else if (t.phase === 'failed') {
        // Failed jobs retain a retry overlay with a localized error summary.
        m.set(id, {
          failed: true,
          preview: !t.url,
          error: translateTaskError(t.error, {
            oversize: t.error === 'oversize',
            uploadLeg: !!t.sha256,
          }),
        });
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

  // Task sink lives in its own effect so its unsubscribe is honoured on teardown.
  // (Inside the guarded init effect above it would be torn down by the second run
  // that the `initialized` write triggers.)
  $effect(() =>
    pipeline.onTask((t) => {
      observeJob(t.jobId);
      // Count panel work as resolved when the task moves to a card or terminates.
      if (!PANEL_STAGES.has(t.phase)) countResolved(t.jobId);
      // Card preview comes from the transcoded artifact, not the picked File.
      if (t.meta && (t.phase === 'uploading' || t.phase === 'failed')) {
        void ensureArtifactPreview(t.jobId, t.meta.type);
      }
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
      // deriveds read them; callbacks run before any derived evaluates, so order is safe
      if (['uploading', 'done', 'failed'].includes(t.phase) && !tempIdByJob.has(t.jobId)) {
        const id = nextTempId--;
        tempIdByJob.set(t.jobId, id);
        jobByTempId.set(id, t.jobId);
        if (!tempCreatedAt.has(t.jobId)) tempCreatedAt.set(t.jobId, Date.now());
        writeTempCreatedAt(tempCreatedAt);
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
    pipeline.addFiles(files, queueSizeProbe);
  }

  onDestroy(() => {
    destroyed = true;
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
