// Two-stage orchestration (page side): pick files → addJob → SharedWorker schedules (image transcode on the SW thread, video delegated back to this page's
// DedicatedWorker via token lease) → dedupe → upload → write op-log. Progress is broadcast via BroadcastChannel, and the SW re-sends job state on reconnect,
// so a refresh never loses tasks.

import { buildUploadOp, routeByMime, translateTaskError } from '$base/upload/pipeline';
import { openOplogDb, appendOp } from '../core/oplog/store';
import { LeaseClient } from './lease';
import { isSwToPage, type JobMeta, type JobPurpose, type SwToPageMessage } from './shared/protocol';
import { pipelineResultAction, shouldWriteAlbumUploadOp } from './uploadPurpose';
import type { Op, UploadPayload } from '$shared/types';
// ?sharedworker puts the SW through Vite's bundler (a bare new URL('./sw.ts',
// import.meta.url) is copied verbatim as an untranspiled .ts asset — broken
// both by TS syntax and by the .ts -> video/mp2t MIME on static hosting).
import SharedWorkerCtor from './sw?sharedworker';

export interface PipelineTaskSnapshot {
  jobId: string;
  fileName: string;
  purpose: JobPurpose;
  phase: string;
  fraction?: number;
  url?: string;
  error?: string;
  meta?: JobMeta;
  /** Stage-1 artifact hash (drives optimistic-entry cleanup after /sync). */
  sha256?: string;
}

export interface PipelineIo {
  /** SharedWorker URL override (E2E / tests). */
  swUrl?: URL;
  /** Per-page video worker factory (injectable to test onerror paths). */
  createVideoWorker?: (
    jobId: string,
    file: Blob,
    mime: string,
    engine: 'video' | 'gif',
  ) => WorkerLike;
  onEvent?: (line: string) => void;
  /**
   * Album upload op exit. The sync engine queues it when provided; otherwise
   * the pipeline writes directly to the op-log for harnesses and unit tests.
   */
  onUploadOp?: (op: Op) => void | Promise<void>;
  /** A job left the SharedWorker (cancelJob) — the page must drop its row/card. */
  onJobRemoved?: (jobId: string) => void;
  /** File outside the accept surface in addFiles — surface a user-visible notice. */
  onRejected?: (fileName: string) => void;
}

export interface WorkerLike {
  postMessage: (m: unknown) => void;
  terminate: () => void;
  set onerror(h: ((e: ErrorEvent) => void) | null);
  set onmessage(h: ((e: MessageEvent) => void) | null);
}

const CH = 'infoto-upload';

/** Upload pipeline client — one instance per page. */
export class UploadPipeline {
  private sw: SharedWorker | null = null;
  private lease: LeaseClient | null = null;
  private bc: BroadcastChannel | null = null;
  private videoWorkers = new Map<string, WorkerLike>();
  private listeners = new Set<(t: PipelineTaskSnapshot) => void>();
  private editorListeners = new Set<(t: PipelineTaskSnapshot) => void>();
  /** Latest non-terminal editor snapshot (editor uploads keep only one in flight, so no map is needed). */
  private editorSnapshot: PipelineTaskSnapshot | null = null;
  /** Last non-terminal phase per editor job — decides upload-leg vs transcode-leg errors. */
  private readonly editorPhase = new Map<string, string>();
  private snapshots = new Map<string, PipelineTaskSnapshot>();
  private io: PipelineIo;
  private db: IDBDatabase | null = null;
  private readonly shaByJob = new Map<string, string>();
  private readonly editorWaiters = new Map<
    string,
    { resolve: (url: string) => void; reject: (error: Error) => void }
  >();
  private readonly pendingAlbumOps = new Set<string>();

  constructor(io: PipelineIo = {}) {
    this.io = io;
  }

  onTask(l: (t: PipelineTaskSnapshot) => void): () => void {
    this.listeners.add(l);
    for (const s of this.snapshots.values()) {
      if (s.purpose === 'album') l(s);
    }
    return () => this.listeners.delete(l);
  }

  /**
   * Editor-image progress (purpose='editor'). Editor jobs run through the very same SharedWorker
   * pipeline as album uploads (transcode → hash → upload); only the result stays private to the
   * owning page, so progress is delivered here instead of to the album listener.
   */
  onEditorTask(l: (t: PipelineTaskSnapshot) => void): () => void {
    this.editorListeners.add(l);
    const live = this.editorSnapshot;
    if (live) l(live);
    return () => this.editorListeners.delete(l);
  }

  private emit(t: PipelineTaskSnapshot): void {
    this.snapshots.set(t.jobId, t);
    if (t.purpose === 'album') {
      for (const l of this.listeners) l(t);
    }
  }

  /** Terminal states are forwarded too — subscribers clear their row on them. */
  private emitEditor(t: PipelineTaskSnapshot): void {
    const terminal = t.phase === 'done' || t.phase === 'failed';
    this.editorSnapshot = terminal ? null : t;
    if (terminal) this.editorPhase.delete(t.jobId);
    else this.editorPhase.set(t.jobId, t.phase);
    for (const l of this.editorListeners) l(t);
  }

  private log(line: string): void {
    this.io.onEvent?.(line);
  }

  /** Minimal snapshot for terminal editor states (clears the progress row). */
  private editorSnapshotOr(jobId: string): PipelineTaskSnapshot {
    return this.editorSnapshot ?? { jobId, fileName: '', purpose: 'editor', phase: 'done' };
  }

  /** Connect SharedWorker + BroadcastChannel, register triggers. */
  start(): void {
    if (this.sw) return;
    this.sw = this.io.swUrl
      ? new SharedWorker(this.io.swUrl, { type: 'module' })
      : new SharedWorkerCtor();
    this.lease = new LeaseClient(this.sw.port, {
      onGranted: (m) => this.startVideoWorker(m.jobId, m.file, m.mime, routeEngine(m.mime)),
      onRevoked: (m) => {
        this.log(`token revoked (no heartbeat for 15s); job ${m.jobId} re-enqueued`);
        this.terminateVideoWorker(m.jobId);
      },
    });
    this.sw.port.onmessage = (e: MessageEvent<unknown>) => {
      const m = e.data;
      if (!isSwToPage(m)) return;
      this.lease?.handleMessage(m);
      this.onSwMessage(m);
    };
    this.sw.port.start();
    // Return video tokens on pagehide independently of visibilitychange.
    this.lease.install();
    // deviceMemory is window-only — report both readings so the SW can size
    // the global video token pool with the base videoPoolSize() pure function
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.sw.port.postMessage({
      t: 'poolHint',
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
    });
    // cross-tab: other tabs' progress enters the local view via BroadcastChannel
    this.bc = 'BroadcastChannel' in window ? new BroadcastChannel(CH) : null;
    this.bc?.addEventListener('message', (e: MessageEvent) => {
      const m = e.data;
      if (!isSwToPage(m)) return;
      // A cancel issued in another tab drops the row here too — the direct port
      // only reaches the tab that owns it, and a pruned/cancelled job would
      // otherwise leave a panel row with no job behind it.
      if (m.t === 'jobRemoved') {
        this.snapshots.delete(m.jobId);
        this.io.onJobRemoved?.(m.jobId);
        return;
      }
      if (m.t !== 'jobStatus' || m.purpose !== 'album') return;
      this.emit({
        jobId: m.jobId,
        fileName: this.snapshots.get(m.jobId)?.fileName ?? m.fileName ?? m.jobId,
        purpose: m.purpose,
        phase: m.phase,
        fraction: m.fraction,
        url: m.url,
        error: m.error,
        meta: m.meta,
        sha256: m.sha256,
      });
    });
  }

  private onSwMessage(m: SwToPageMessage): void {
    if (m.t === 'jobRemoved') {
      // cancelJob echoed back (broadcast — every tab holding the row drops it).
      // An in-flight editor waiter rejects so its owner's await settles; the
      // editor row state clears so a reopened dialog never replays it.
      const waiter = this.editorWaiters.get(m.jobId);
      if (waiter) {
        this.editorWaiters.delete(m.jobId);
        waiter.reject(new Error('上传已取消'));
      }
      if (this.editorSnapshot?.jobId === m.jobId) this.editorSnapshot = null;
      this.editorPhase.delete(m.jobId);
      this.snapshots.delete(m.jobId);
      this.io.onJobRemoved?.(m.jobId);
      return;
    }
    if (m.t !== 'jobStatus') return;
    const action = pipelineResultAction(m, this.editorWaiters.has(m.jobId));
    if (action === 'resolve' || action === 'reject') {
      const waiter = this.editorWaiters.get(m.jobId);
      if (!waiter) return;
      this.editorWaiters.delete(m.jobId);
      this.sw?.port.postMessage({ t: 'editorResultAck', jobId: m.jobId });
      // Read the leg before emitEditor clears it: a failure after 'uploading'
      // is an upload error, not a transcode one.
      const uploadLeg = this.editorPhase.get(m.jobId) === 'uploading';
      // Terminal editor states are private to the owner page (never broadcast),
      // so clear the progress row here.
      this.emitEditor({ ...this.editorSnapshotOr(m.jobId), phase: m.phase });
      if (action === 'resolve' && m.url) waiter.resolve(m.url);
      else
        waiter.reject(
          new Error(
            translateTaskError(m.error, {
              oversize: m.error === 'oversize',
              sha256: uploadLeg ? (m.sha256 ?? '-') : undefined,
            }),
          ),
        );
      return;
    }
    if (m.purpose === 'editor') {
      // Progress is broadcast to every port; only the page that enqueued the
      // job (it holds the waiter) owns the row.
      if (!this.editorWaiters.has(m.jobId)) return;
      // Same pipeline as album uploads — surface transcode/hash/upload progress.
      this.emitEditor({
        jobId: m.jobId,
        fileName: this.snapshots.get(m.jobId)?.fileName ?? m.fileName ?? m.jobId,
        purpose: 'editor',
        phase: m.phase,
        fraction: m.fraction,
        url: m.url,
        meta: m.meta,
        sha256: m.sha256,
      });
      return;
    }
    // Capture before emit stores the URL in the snapshot.
    const alreadyWritten = !!this.pendingAlbumOps.has(m.jobId);
    if (m.sha256) this.shaByJob.set(m.jobId, m.sha256);
    this.emit({
      jobId: m.jobId,
      fileName: this.snapshots.get(m.jobId)?.fileName ?? m.fileName ?? m.jobId,
      purpose: m.purpose,
      phase: m.phase,
      fraction: m.fraction,
      url: m.url,
      error: m.error,
      meta: m.meta,
      sha256: m.sha256,
    });
    if (shouldWriteAlbumUploadOp(m.purpose, m.phase, m.url, m.meta, alreadyWritten)) {
      this.pendingAlbumOps.add(m.jobId);
      void this.writeUploadOp(m.jobId, m.url!, m.meta!)
        .catch((error) => {
          this.pendingAlbumOps.delete(m.jobId);
          this.emit({
            jobId: m.jobId,
            fileName: this.snapshots.get(m.jobId)?.fileName ?? m.fileName ?? m.jobId,
            purpose: m.purpose,
            phase: 'failed',
            error: error instanceof Error ? error.message : 'oplog_write_failed',
            meta: m.meta,
            sha256: m.sha256,
          });
        })
        .finally(() => {
          this.pendingAlbumOps.delete(m.jobId);
        });
    } else if (m.phase === 'failed') {
      this.log(
        `job ${m.jobId} failed: ${m.error ?? 'unknown'} (artifact kept in OPFS, manual retry available)`,
      );
    } else if (m.phase === 'duplicate') {
      this.log(`job ${m.jobId} duplicate: sha256 cache hit, upload skipped`);
    }
  }

  private async writeUploadOp(jobId: string, url: string, meta: JobMeta): Promise<void> {
    // payload has no created_at / uploader — server-authoritative (spec)
    const payload: UploadPayload = {
      sha256: this.shaByJob.get(jobId) ?? '',
      url,
      width: meta.width,
      height: meta.height,
      size: meta.size,
      type: meta.type,
    };
    const op: Op = buildUploadOp(payload);
    if (this.io.onUploadOp) {
      await this.io.onUploadOp(op);
    } else if (!this.db) {
      this.db = await openOplogDb();
      await appendOp(this.db, op);
    } else {
      await appendOp(this.db, op);
    }
    this.sw?.port.postMessage({ t: 'opWritten', jobId });
    this.log(`job ${jobId} URL written to op-log, awaiting sync`);
  }

  uploadEditorImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      // Same accept surface as the waterfall (image/*,video/*): the editor
      // rides the identical pipeline, and GIF / video both come out as VP9 WebM.
      if (!routeByMime(file.type)) {
        reject(new Error('不支持的文件类型'));
        return;
      }
      const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Show the row immediately: the SW's own 'queued' echo is one hop away.
      this.emitEditor({ jobId, fileName: file.name, purpose: 'editor', phase: 'queued' });
      try {
        if (!this.sw) this.start();
        this.editorWaiters.set(jobId, { resolve, reject });
        this.sw!.port.postMessage({
          t: 'addJob',
          jobId,
          purpose: 'editor',
          fileName: file.name,
          mime: file.type,
          file,
        });
      } catch (error) {
        this.editorWaiters.delete(jobId);
        this.emitEditor({ jobId, fileName: file.name, purpose: 'editor', phase: 'failed' });
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Entry: picked files (the accept list is `image/*,video/*` — exactly
   * routeByMime's coverage surface, per the contract audit clause).
   * `onQueued` fires per accepted file with its job id — the page can grab the
   * File (the SW clone takes over from here) e.g. to probe source dimensions.
   */
  addFiles(files: FileList | File[], onQueued?: (jobId: string, file: File) => void): void {
    if (!this.sw) this.start();
    for (const file of Array.from(files)) {
      const route = routeByMime(file.type);
      if (!route) {
        // Empty MIME (common on Windows) and exotic types land here — a silent
        // console line left users clicking upload with zero feedback.
        this.log(
          `file ${file.name} (${file.type || 'no MIME'}) is outside the accept surface, rejected`,
        );
        this.io.onRejected?.(file.name);
        continue;
      }
      const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.emit({ jobId, fileName: file.name, purpose: 'album', phase: 'queued' });
      onQueued?.(jobId, file);
      this.sw!.port.postMessage({
        t: 'addJob',
        jobId,
        purpose: 'album',
        fileName: file.name,
        mime: file.type,
        file,
      });
    }
  }

  /** Manual retry handle (failed jobs; artifacts stay in OPFS). */
  retry(jobId: string): void {
    this.sw?.port.postMessage({ t: 'retryJob', jobId });
  }

  /**
   * Retry a failed editor upload and deliver the URL via a fresh Promise.
   * The original waiter was consumed on the first failure, so we re-register
   * one before telling the SW to re-run (the OPFS artifact is reused when
   * stage 1 already succeeded).
   */
  retryEditorUpload(jobId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.editorWaiters.set(jobId, { resolve, reject });
      this.retry(jobId);
    });
  }

  /**
   * Cancel handle (any phase): the SW deletes the record and broadcasts
   * `jobRemoved`, which drops the row/card in every holding tab. Also the
   * only way to stop a failed job from replaying its card after a refresh.
   */
  cancel(jobId: string): void {
    this.sw?.port.postMessage({ t: 'cancelJob', jobId });
  }

  /** One of the token release paths: destroy this page's video worker when done. */
  private terminateVideoWorker(jobId: string): void {
    const w = this.videoWorkers.get(jobId);
    if (w) {
      w.terminate();
      this.videoWorkers.delete(jobId);
    }
  }

  /**
   * After leaseGranted, create/reuse this page's top-level DedicatedWorker. Worker creation
   * failure or onerror → mark failed and return the token; never fall back to the main thread
   * (the contract forbids main-thread video encoding).
   */
  private startVideoWorker(jobId: string, file: Blob, mime: string, engine: 'video' | 'gif'): void {
    let w: WorkerLike;
    try {
      w =
        this.io.createVideoWorker?.(jobId, file, mime, engine) ??
        (new Worker(new URL('./video.worker.ts', import.meta.url), {
          type: 'module',
        }) as WorkerLike);
    } catch (e) {
      this.sw?.port.postMessage({
        t: 'videoFailed',
        jobId,
        error: `worker_create_failed:${String(e)}`,
      });
      this.lease?.release();
      return;
    }
    this.videoWorkers.set(jobId, w);
    w.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
      const m = e.data;
      if (m['t'] === 'videoProgress') {
        this.sw?.port.postMessage({ t: 'videoProgress', jobId, fraction: m['fraction'] });
      } else if (m['t'] === 'videoResult') {
        // structured-clone forward, no transfer list (Blob is not Transferable)
        this.sw?.port.postMessage({
          t: 'videoResult',
          jobId,
          blob: m['blob'],
          width: m['width'],
          height: m['height'],
          hasAudio: m['hasAudio'],
        });
        this.lease?.release(); // Completion returns the concurrency token.
        w.terminate();
        this.videoWorkers.delete(jobId);
      } else if (m['t'] === 'videoFailed') {
        this.sw?.port.postMessage({ t: 'videoFailed', jobId, error: m['error'] });
        this.lease?.release(); // Failure also returns the concurrency token.
        w.terminate();
        this.videoWorkers.delete(jobId);
      }
    };
    w.onerror = (e: ErrorEvent) => {
      // release path: worker onerror (one of the contract's four token audit paths)
      this.sw?.port.postMessage({ t: 'videoFailed', jobId, error: `worker_error:${e.message}` });
      this.lease?.release();
      w.terminate();
      this.videoWorkers.delete(jobId);
    };
    w.postMessage({ t: 'videoJob', jobId, file, mime, engine });
  }
}

function routeEngine(mime: string): 'video' | 'gif' {
  const r = routeByMime(mime);
  return r?.engine === 'gif' ? 'gif' : 'video';
}

/**
 * Source-file dimensions, probed on the page while it still holds the File
 * (after addJob only the SW's clone remains). A transcode that dies before
 * producing meta reuses these so its failure card keeps the real aspect
 * ratio instead of the 800×600 placeholder. Null when probing fails.
 */
export async function probeSourceSize(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  const mime = (file.type || '').toLowerCase();
  try {
    if (mime.startsWith('image/')) {
      // Decodes the first frame (works for GIF too); the bitmap is closed right away.
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size.width > 0 && size.height > 0 ? size : null;
    }
    if (mime.startsWith('video/')) {
      // Metadata-only load — no frame decoding, cheap even for large files.
      return await new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = () => {
          const size = { width: v.videoWidth, height: v.videoHeight };
          URL.revokeObjectURL(url);
          resolve(size.width > 0 && size.height > 0 ? size : null);
        };
        v.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        v.src = url;
      });
    }
  } catch {
    return null;
  }
  return null;
}
