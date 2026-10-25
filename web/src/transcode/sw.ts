// SharedWorker scheduler for image transcoding, leased video workers, direct editor uploads, and heartbeat cleanup.

import type { MediaType } from '$shared/types';
import { clamp01 } from '$base/lib/num';
import {
  artifactExt,
  imagePoolSize,
  isOversize,
  routeByMime,
  uid,
  uploadPoolSize,
  videoPoolSize,
} from '$base/upload/pipeline';
import { postUpload, type UploadResult } from '../core/api/uploadClient';
import {
  deletePhotoRecord,
  isKnownAlbumSha,
  openOplogDb,
  putPhotoRecord,
  readPhotoRecord,
  readPhotoRecords,
  type PhotoRecord,
} from '../core/oplog';
import { readArtifact, removeArtifact, storeArtifact } from './opfs';
import { transcodeImage } from './image.worker';
import {
  LEASE_TIMEOUT_MS,
  isPageToSw,
  type JobMeta,
  type JobPhase,
  type JobPurpose,
  type JobStatusMessage,
  type PageToSwMessage,
  type SwToPageMessage,
} from './protocol';

// ---- environment & channels ----------------------------------------------------

const ports = new Set<MessagePort>();
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('infoto-upload') : null;

function broadcast(m: SwToPageMessage): void {
  for (const p of ports) {
    try {
      p.postMessage(m);
    } catch {
      // Port closed; idle sweep will clean it.
    }
  }
  bc?.postMessage(m);
}

// ---- job state -----------------------------------------------------------------

interface JobRec {
  jobId: string;
  purpose: JobPurpose;
  fileName: string;
  mime: string;
  file: Blob;
  engine: 'image' | 'video' | 'gif';
  phase: JobPhase;
  /** Stage-1 artifact metadata (needed by stage 2). */
  artifact?: { ext: 'webp' | 'webm'; size: number };
  sha256?: string;
  meta?: JobMeta;
  url?: string;
  /** When the facade returned `url` (ms epoch) — the upload's real completion time. */
  createdAt?: number;
  error?: string;
  /** The upload op has been written to the op-log by some page. */
  opWritten: boolean;
  editorResultAcked: boolean;
  /** Cancellation flag for image jobs. */
  cancelled: boolean;
  /** Aborts the in-flight /upload when the job is cancelled mid-transfer. */
  uploadAbort?: AbortController;
  /** First time the sweep observed this job in a terminal phase (prune clock). */
  terminalAt?: number;
  /** Token lease info (video/gif). */
  leaseId?: string;
}

const jobs = new Map<string, JobRec>();
const imageQueue: string[] = [];
const videoQueue: string[] = []; // jobIds waiting for a token
let imageRunning = 0;
let db: IDBDatabase | null = null;

/**
 * Upload-leg concurrency, decoupled from the transcode pools: those bound CPU (image encode)
 * and device memory (video encode), while this one bounds how many POSTs a single upstream
 * sees at once. Every upload leg passes through it — image, video, editor and resumed alike.
 */
const uploadLimit = uploadPoolSize(
  'navigator' in self
    ? (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink
    : undefined,
);
let uploadRunning = 0;
const uploadWaiters: Array<() => void> = [];

/** Take one upload slot, waiting while the ceiling is reached. */
function acquireUploadSlot(): Promise<void> {
  if (uploadRunning < uploadLimit) {
    uploadRunning++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => uploadWaiters.push(resolve));
}

/** Return one upload slot; a waiting job takes it directly, so the count never dips and a
 *  newcomer cannot jump the queue. */
function releaseUploadSlot(): void {
  const next = uploadWaiters.shift();
  if (next) next();
  else uploadRunning--;
}

// ---- lease pool ----------------------------------------------------------------

interface Lease {
  leaseId: string;
  jobId: string;
  port: MessagePort;
  lastBeat: number;
  /** The owning document is hidden. The browser throttles a hidden page's heartbeat timer,
   *  so its silence says nothing about whether the work is still alive. */
  hidden: boolean;
}
const leases = new Map<string, Lease>();

/** Artifact extension for a job, derived from its route engine — `meta` only exists once the
 *  encode has finished, but a partial artifact already carries this name. */
function jobArtifactExt(rec: JobRec): 'webp' | 'webm' {
  return rec.engine === 'image' ? 'webp' : 'webm';
}

/** Video concurrency, bounded to one or two jobs and refined by page capability hints. */
let videoLimit = videoPoolSize('navigator' in self ? navigator : {});
/** Upload facade from the page's /sync response; unset means "use the local simulation". */
let mediaHostUrl: string | undefined;

function notify(rec: JobRec, extra: Partial<JobStatusMessage> = {}): void {
  // Ignore progress updates for cancelled jobs.
  if (rec.cancelled) return;
  const message: JobStatusMessage = {
    t: 'jobStatus',
    jobId: rec.jobId,
    purpose: rec.purpose,
    fileName: rec.fileName,
    phase: rec.phase,
    url: rec.url,
    createdAt: rec.createdAt,
    error: rec.error,
    meta: rec.meta,
    sha256: rec.sha256,
    ...extra,
  };
  if (rec.purpose === 'editor' && (rec.phase === 'done' || rec.phase === 'failed')) {
    if (!rec.editorResultAcked) {
      const port = ownerPort(rec);
      if (port) {
        try {
          port.postMessage(message);
        } catch {
          // Port closed; the editor waiter will be rejected on reconnect.
        }
      }
    }
    return;
  }
  broadcast(message);
}

/**
 * Mark a job failed with `error` and notify its holders; centralises the repeated
 * terminal-failure assignment.
 *
 * The resume record is kept when the failure happened in the upload leg. `rec.phase` at the
 * call is the stage that failed: `transcoding` means no artifact exists yet, so a resumed
 * upload would have nothing to send, while `uploading` means the artifact is on disk and the
 * record is what brings the card back after a reload. Keeping it is also what stops the card
 * from vanishing on refresh — the page rebuilds the job from the record and replays it.
 */
function failJob(rec: JobRec, error: string): void {
  const failedInUpload = rec.phase === 'uploading';
  rec.phase = 'failed';
  rec.error = error;
  // A transcode failure ends the job for good: there is no artifact to resume from, so the
  // record would only re-run a transcode that already failed. Only cancel removes the artifact.
  if (!failedInUpload) {
    if (db && rec.sha256) void deletePhotoRecord(db, rec.sha256).catch(() => undefined);
    // No card renders this job (see `rendersCard`), so nothing can press retry and the source
    // Blob would otherwise sit in this worker until the record is pruned — up to the full file
    // size for ten minutes. Editor jobs never reach here before `uploading`.
    rec.file = EMPTY_BLOB;
    notify(rec);
    return;
  }
  // An upload failure keeps its record, marked: the artifact is still on disk, so the card
  // survives a reload and the user can retry it by hand. Without the flag the reload would
  // resume the upload on its own, which is a retry nobody asked for.
  if (db) {
    const record = photoRecord(rec, 'failed');
    if (record) void putPhotoRecord(db, record).catch(() => undefined);
  }
  notify(rec);
}

/** The resume record for a job whose stage 1 finished, or null while it has not. */
/** The record this job owns, keyed by the photo's sha — the one durable address it has. */
function photoRecord(rec: JobRec, status: PhotoRecord['status']): PhotoRecord | null {
  if (!rec.sha256 || !rec.meta || !rec.artifact) return null;
  return {
    sha256: rec.sha256,
    status,
    meta: rec.meta,
    fileName: rec.fileName,
    // The artifact's name has to exist before its own digest does (it is hashed while being
    // written), so the job id survives here as a handle, not as a key.
    artifact: { key: rec.jobId, ext: rec.artifact.ext },
    ...(rec.url ? { url: rec.url } : {}),
    ...(rec.createdAt ? { createdAt: rec.createdAt } : {}),
    ...(status === 'failed' && rec.error ? { error: rec.error } : {}),
  };
}

/** Measured byte progress. Missing totals and completed stages report no fraction; phase changes signal completion. */
function notifyBytes(rec: JobRec, total: number, written: number): void {
  if (rec.cancelled || rec.phase !== 'hashing' || total <= 0) return;
  notify(rec, { fraction: clamp01(written / total) });
}

// ---- scheduling ----------------------------------------------------------------

function pumpImage(): void {
  const pool = imagePoolSize(
    'navigator' in self ? navigator.hardwareConcurrency : undefined,
    'navigator' in self
      ? (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink
      : undefined,
  );
  while (imageRunning < pool && imageQueue.length > 0) {
    const id = imageQueue.shift()!;
    const rec = jobs.get(id);
    if (!rec || rec.cancelled || rec.phase !== 'queued') continue;
    imageRunning++;
    void runImageJob(rec).finally(() => {
      imageRunning--;
      pumpImage();
    });
  }
}

function pumpVideoLeases(): void {
  while (leases.size < videoLimit && videoQueue.length > 0) {
    const jobId = videoQueue.shift()!;
    const rec = jobs.get(jobId);
    if (!rec || rec.cancelled || rec.phase !== 'lease-wait') continue;
    const port = ownerPort(rec);
    if (!port) {
      // the owning page is gone: mark failed (the source Blob dies with it, no reassignment)
      failJob(rec, 'source_unavailable');
      continue;
    }
    const leaseId = uid();
    rec.phase = 'transcoding';
    rec.leaseId = leaseId;
    leases.set(leaseId, { leaseId, jobId, port, lastBeat: Date.now(), hidden: false });
    port.postMessage({
      t: 'leaseGranted',
      leaseId,
      jobId,
      file: rec.file,
      mime: rec.mime,
      fileName: rec.fileName,
    });
    // Keep progress indeterminate until the video worker reports a measured fraction.
    notify(rec);
  }
}

/** Video jobs always transcode on the page that added them (the source Blob lives on a clone reference there). */
function ownerPort(rec: JobRec): MessagePort | null {
  const pid = owners.get(rec.jobId);
  if (pid === undefined) return null;
  const entry = portById.get(pid);
  return entry && ports.has(entry) ? entry : null;
}

const owners = new Map<string, number>();
const portIds = new Map<MessagePort, number>();
let nextPortId = 1;
const portById = new Map<number, MessagePort>();
/** Last message time per port — the only liveness signal a port offers. */
const portLastSeen = new Map<number, number>();
/** Port inactivity threshold for abandoning leases held by disconnected pages. */
const DEAD_OWNER_MS = 120_000;
/** A port with no owned jobs that has been silent this long is swept (it re-registers on its next message). */
const PORT_IDLE_MS = 10 * 60_000;
/** How many terminal job records are kept for replay / manual retry. */
const TERMINAL_JOB_CAP = 30;
/** A failed job keeps its source file this long (retry needs it) before it is released. */
const FAILED_JOB_TTL_MS = 10 * 60_000;
/** Source release placeholder — an empty Blob keeps the field type without holding bytes. */
const EMPTY_BLOB = new Blob();

/** Forget a job everywhere it is indexed (no broadcast: pages own their own rows). */
function forgetJob(jobId: string): void {
  const rec = jobs.get(jobId);
  // A held lease occupies a video slot, and the reaper can no longer match it to a record
  // once the record is gone — so it has to go with the job.
  if (rec?.leaseId) leases.delete(rec.leaseId);
  jobs.delete(jobId);
  owners.delete(jobId);
  const vi = videoQueue.indexOf(jobId);
  if (vi >= 0) videoQueue.splice(vi, 1);
  const ii = imageQueue.indexOf(jobId);
  if (ii >= 0) imageQueue.splice(ii, 1);
}

// ---- stage 1: images (on the SharedWorker thread) ---------------------------------

async function runImageJob(rec: JobRec): Promise<void> {
  rec.phase = 'transcoding';
  // No fraction: image transcoding cannot measure itself mid-flight, so the row stays
  // indeterminate instead of sitting at a fake 0%.
  notify(rec);
  try {
    const r = await transcodeImage(rec.file);
    if (rec.cancelled) return;
    if (!r.ok) {
      failJob(rec, r.error);
      return;
    }
    rec.phase = 'hashing';
    notify(rec);
    if (rec.cancelled) return;
    // Report bytes hashed and written relative to the artifact size.
    const { sha256, bytes } = await storeArtifact(rec.jobId, r.blob, 'webp', (written) => {
      notifyBytes(rec, r.blob.size, written);
    });
    if (rec.cancelled) return;
    rec.sha256 = sha256;
    rec.meta = { width: r.width, height: r.height, size: bytes, type: 0 };
    rec.artifact = { ext: 'webp', size: bytes };
    await afterStage1(rec);
  } catch (e) {
    failJob(rec, String((e as Error)?.message ?? e));
  }
}

// ---- stage 1 done: dedupe → stage 2 ------------------------------------------------

/**
 * Stage 1 done: dedupe, then stage 2. Only album jobs ever reach this point — the editor
 * uploads the picked file as-is (see runEditorUpload) and never transcodes.
 */
async function afterStage1(rec: JobRec): Promise<void> {
  if (!db) db = await openOplogDb().catch(() => null as unknown as IDBDatabase);
  if (db && rec.sha256) {
    if (rec.cancelled) return;
    // Known means the album has it *or* this client already holds it: a photo whose upload is
    // still unconfirmed must not be uploaded twice just because no snapshot has landed yet.
    const sha = rec.sha256;
    const held = await readPhotoRecord(db, sha)
      .then((record) => record !== null && record.status !== 'failed')
      .catch(() => false);
    const known = held || (await isKnownAlbumSha(db, sha).catch(() => false));
    if (known) {
      rec.phase = 'duplicate';
      notify(rec);
      return;
    }
  }
  rec.phase = 'uploading';
  notify(rec, { fraction: 0 });
  // Remember the job: a reload kills this worker, but the artifact is on disk, so the
  // upload can be resumed instead of silently losing a photo the user already uploaded.
  if (db) {
    const record = photoRecord(rec, 'uploading');
    if (record) {
      if (rec.cancelled) return;
      await putPhotoRecord(db, record).catch(() => undefined);
    }
  }
  await runUpload(rec);
}

/** Upload the editor's cloned source directly, without transcoding, hashing, or OPFS storage. */
async function runEditorUpload(rec: JobRec): Promise<void> {
  rec.phase = 'uploading';
  notify(rec, { fraction: 0 });
  await runUpload(rec, rec.file);
}

/** Stage 2: 100MB pre-check + one /upload attempt, no auto-retry — a failure marks the
 *  file failed and deletes its resume record, so a later page load will not re-run the
 *  upload; retryJob is manual-only, reusing the artifact that stays in OPFS.
 *  `source` = the blob to send; absent → the album artifact is read back from OPFS
 *  (the editor passes the picked file it still holds). */
async function runUpload(rec: JobRec, source?: Blob): Promise<void> {
  let blob: Blob | null;
  let fileName: string | undefined;
  if (source) {
    blob = source;
  } else {
    const ext = artifactExt(rec.meta!.type === 0 ? 'image' : 'webm');
    fileName = `m.${ext}`;
    notify(rec, { fraction: undefined });
    if (rec.cancelled) return;
    blob = await readArtifact(rec.jobId, ext);
  }
  if (rec.cancelled) return;
  if (!blob) {
    failJob(rec, 'source_unavailable');
    return;
  }
  // >100MB fails immediately; the artifact stays in OPFS (size limit)
  if (isOversize(blob.size)) {
    failJob(rec, 'oversize');
    return;
  }
  // The facade address arrives with /sync before any job can run. Without it there is no
  // host to upload to, and guessing one would send a user's photo to a place nobody
  // configured — so the job fails with the reason instead.
  if (!mediaHostUrl) {
    failJob(rec, 'media_host_unset');
    return;
  }
  const abort = new AbortController();
  rec.uploadAbort = abort;
  if (rec.cancelled) {
    rec.uploadAbort = undefined;
    return;
  }
  // Wait for the upload leg's own slot: the transcode pools are sized for CPU and device
  // memory, and letting them bound the network leg opened one concurrent POST per core
  // against a single upstream. A cancel that lands while queued is caught below, and the
  // slot it briefly takes is handed straight to the next waiter.
  await acquireUploadSlot();
  let r: UploadResult | null = null;
  try {
    if (!rec.cancelled) {
      r = await postUpload(blob, {
        mediaHostUrl: mediaHostUrl!,
        fileName,
        signal: abort.signal,
        onProgress: (fraction) => notify(rec, { fraction }),
      });
    }
  } finally {
    rec.uploadAbort = undefined;
    releaseUploadSlot();
  }
  // Cancelled mid-upload or while queued: discard the result — no URL, no op write, no notify
  // (a photo whose owner cancelled must never land in the album).
  if (!r || rec.cancelled) return;
  if (r.ok) {
    rec.url = r.url;
    // The photo's own timestamp: the instant the host accepted it. `serverTime` is read
    // once per /sync request, so a batch of uploads would otherwise share one millisecond
    // and "latest" could not order them.
    rec.createdAt = Date.now();
    // No prewarm here: this worker's fetch does not populate the renderer's cache, so it
    // bought a second download of every artifact and up to two seconds of delay before
    // `done`. The page preloads the URL with the element that will paint it instead, and
    // keeps the local preview on screen until that lands.
    rec.phase = 'done';
    // The record is not deleted here: the page turns it into `hosted` in the same transaction
    // that appends the upload op, so the photo always has a durable trace. Replay only ever
    // resumes a record still marked `uploading`, which is what stops a completed upload from
    // running twice on the next page load.
    notify(rec);
    return;
  }
  failJob(rec, r.error);
}

// ---- video: page callbacks ---------------------------------------------------------

function onVideoResult(
  rec: JobRec,
  result: { sha256: string; bytes: number; width: number; height: number; hasAudio: boolean },
): void {
  if (rec.leaseId) leases.delete(rec.leaseId);
  void (async () => {
    try {
      if (rec.cancelled) return;
      const type: MediaType = result.hasAudio ? 2 : 1;
      // The page worker already wrote the artifact to OPFS and hashed the same bytes while
      // encoding, so there is no separate hashing phase here: one measured progress covers
      // encode, write and digest alike.
      rec.sha256 = result.sha256;
      rec.meta = { width: result.width, height: result.height, size: result.bytes, type };
      rec.artifact = { ext: 'webm', size: result.bytes };
      await afterStage1(rec);
    } catch (e) {
      failJob(rec, String((e as Error)?.message ?? e));
    } finally {
      pumpVideoLeases();
    }
  })();
}

function onVideoFailed(rec: JobRec, error: string): void {
  if (rec.leaseId) leases.delete(rec.leaseId);
  failJob(rec, error);
  pumpVideoLeases();
}

/** Manual retry handle: re-enqueue a failed job; skip transcode when the artifact is already in OPFS. */
function onRetry(jobId: string): void {
  const rec = jobs.get(jobId);
  if (!rec) {
    // Notify holding pages when a retry targets a reclaimed or cancelled job.
    broadcast({ t: 'jobRemoved', jobId });
    return;
  }
  if (rec.phase !== 'failed' && rec.phase !== 'done') return;
  rec.error = undefined;
  rec.url = undefined;
  rec.opWritten = false;
  rec.editorResultAcked = false;
  rec.cancelled = false;
  if (rec.purpose === 'editor') {
    // The editor's only leg is the upload, and the picked file is still in the record.
    void runEditorUpload(rec).catch((e) => failJob(rec, String((e as Error)?.message ?? e)));
    return;
  }
  if (rec.artifact && rec.sha256) {
    // artifact already on disk: go straight to dedupe/upload
    rec.phase = 'uploading';
    notify(rec, { fraction: 0 });
    void runUpload(rec).catch((e) => failJob(rec, String((e as Error)?.message ?? e)));
    return;
  }
  rec.phase = 'queued';
  notify(rec);
  if (rec.engine === 'image') imageQueue.push(jobId);
  else {
    rec.phase = 'lease-wait';
    videoQueue.push(jobId);
    pumpVideoLeases();
  }
  pumpImage();
}

// ---- lease reaper (force-revoke after 15s without a heartbeat, unless the page is hidden) ----

setInterval(() => {
  const now = Date.now();
  for (const [leaseId, lease] of leases) {
    const pid = owners.get(lease.jobId);
    const seen = pid === undefined ? 0 : (portLastSeen.get(pid) ?? 0);
    const dead = pid === undefined || now - seen > DEAD_OWNER_MS;
    // A hidden page's heartbeat is throttled to roughly one tick a minute, so a missed
    // heartbeat is not evidence of death: only the dead-owner threshold retires its lease.
    const stale = lease.hidden ? dead : now - lease.lastBeat > LEASE_TIMEOUT_MS;
    if (!stale) continue;
    leases.delete(leaseId);
    const rec = jobs.get(lease.jobId);
    if (!rec || rec.leaseId !== leaseId) continue;
    if (dead) {
      // Drop jobs whose owning page has exceeded the inactivity threshold.
      const ext = jobArtifactExt(rec);
      forgetJob(rec.jobId);
      void removeArtifact(rec.jobId, ext);
      continue;
    }
    rec.leaseId = undefined;
    rec.phase = 'lease-wait';
    // The revoked encode left a partial artifact behind; the re-run writes it from the top.
    void removeArtifact(rec.jobId, jobArtifactExt(rec));
    // in-flight job re-enqueues (transcoding is idempotent; OPFS artifact sha256 dedupe backstops)
    videoQueue.push(rec.jobId);
    try {
      lease.port.postMessage({ t: 'leaseRevoked', leaseId, jobId: lease.jobId });
    } catch {
      // The port may have been swept already; the page re-registers on its next message.
    }
    notify(rec);
    pumpVideoLeases();
  }
}, 2_000);

/** Release source blobs and expired terminal-job records during periodic housekeeping. */
function reclaimTerminalJobs(): void {
  const now = Date.now();
  const pruneable: JobRec[] = [];
  for (const rec of jobs.values()) {
    if (rec.phase !== 'done' && rec.phase !== 'failed' && rec.phase !== 'duplicate') continue;
    rec.terminalAt ??= now;
    // Stage 1 can be skipped when the artifact alone is enough to re-run the
    // upload leg — that is the point where the source stops being worth keeping.
    if (rec.phase !== 'failed' || (rec.artifact && rec.sha256)) rec.file = EMPTY_BLOB;
    const spent =
      rec.phase === 'duplicate' ||
      (rec.phase === 'done' && (rec.purpose === 'editor' || rec.opWritten)) ||
      (rec.phase === 'failed' && now - rec.terminalAt > FAILED_JOB_TTL_MS);
    if (spent) pruneable.push(rec);
  }
  // Map iteration is insertion-ordered: the front is the oldest record.
  while (pruneable.length > TERMINAL_JOB_CAP) {
    const rec = pruneable.shift()!;
    const ext = rec.artifact?.ext;
    forgetJob(rec.jobId);
    // The artifact is unreferenced once the record is gone; failed jobs keep
    // theirs until this point precisely so a manual retry can reuse it.
    if (ext) void removeArtifact(rec.jobId, ext);
    // A pruned failure has nothing left to retry, so its record goes too. A `done` job's record
    // is a `hosted` card the page owns, and it must survive this sweep.
    if (db && rec.phase === 'failed' && rec.sha256) {
      void deletePhotoRecord(db, rec.sha256).catch(() => undefined);
    }
  }
}

setInterval(reclaimTerminalJobs, 15_000);
/** Idle ports own no jobs by definition, so sweeping them can't orphan work. */
setInterval(() => {
  const now = Date.now();
  const busy = new Set(owners.values());
  for (const [port, pid] of portIds) {
    if (!ports.has(port)) continue;
    if (busy.has(pid)) continue;
    if (now - (portLastSeen.get(pid) ?? 0) <= PORT_IDLE_MS) continue;
    ports.delete(port);
    portIds.delete(port);
    portById.delete(pid);
    portLastSeen.delete(pid);
  }
}, 60_000);

// ---- connection & message dispatch ---------------------------------------------------

/** Resume interrupted album uploads from persisted metadata and OPFS artifacts. */
let resumed = false;
/**
 * Rebuild jobs from the photo records an earlier page left `uploading` or `failed`.
 *
 * The record is keyed by the photo's sha and carries the artifact handle, so resumption needs no
 * second store: a record whose artifact is still on disk is a photo the user already paid to
 * transcode, and one whose artifact is gone is garbage the same read removes.
 */
async function resumePhotoRecords(): Promise<void> {
  if (resumed) return;
  resumed = true;
  if (!db) db = await openOplogDb().catch(() => null);
  if (!db) {
    resumed = false;
    return;
  }
  const records = await readPhotoRecords(db).catch(() => []);
  for (const record of records) {
    // A `hosted` record belongs to a queued upload op, not to this worker: the server has the
    // photo, so there is nothing to resume and the page draws the card from the record itself.
    if (record.status === 'hosted') continue;
    if (!record.meta || !record.artifact) continue;
    const { key, ext } = record.artifact;
    if (jobs.has(key)) continue;
    const blob = await readArtifact(key, ext);
    if (!blob) {
      void deletePhotoRecord(db, record.sha256).catch(() => undefined);
      continue;
    }
    const rec: JobRec = {
      jobId: key,
      purpose: 'album',
      fileName: record.fileName ?? '',
      mime: '',
      file: EMPTY_BLOB,
      engine: 'image',
      phase: record.status === 'failed' ? 'failed' : 'uploading',
      error: record.error,
      artifact: { ext, size: record.meta.size },
      sha256: record.sha256,
      meta: record.meta,
      opWritten: false,
      editorResultAcked: false,
      cancelled: false,
    };
    jobs.set(key, rec);
    // A record left behind by a failed upload leg is rebuilt as the failed card it was, not
    // restarted: the artifact is on disk, so the card has its image back and the retry is the
    // user's to press. Only an `uploading` record resumes — that is an upload interrupted
    // mid-transfer, which nobody rejected.
    if (record.status === 'failed') {
      notify(rec);
      continue;
    }
    notify(rec, { fraction: 0 });
    void runUpload(rec).catch((e) => failJob(rec, String((e as Error)?.message ?? e)));
  }
}
onconnect = (e: MessageEvent) => {
  const port = e.ports[0]!;
  ports.add(port);
  const pid = nextPortId++;
  portIds.set(port, pid);
  portById.set(pid, port);
  port.onmessage = (ev: MessageEvent<unknown>) => {
    const m = ev.data;
    if (!isPageToSw(m)) return;
    handleMessage(port, m);
  };
  port.onmessageerror = () => undefined;
  // Resume before replaying: jobs rebuilt from disk must be in `jobs` so the replay
  // below hands the fresh page its cards.
  void resumePhotoRecords().then(() => replayJobs(port));
};

/** Replay non-terminal album jobs on reconnect. Editor results remain private to their owning page. */
function replayJobs(port: MessagePort): void {
  for (const rec of jobs.values()) {
    if (rec.purpose === 'editor') continue;
    if (rec.phase === 'done' || rec.phase === 'duplicate') continue;
    port.postMessage({
      t: 'jobStatus',
      jobId: rec.jobId,
      purpose: rec.purpose,
      fileName: rec.fileName,
      phase: rec.phase,
      url: rec.url,
      error: rec.error,
      meta: rec.meta,
      sha256: rec.sha256,
    });
  }
}

function handleMessage(port: MessagePort, m: PageToSwMessage): void {
  // Refresh port liveness and registration before handling messages.
  let pid = portIds.get(port);
  if (pid === undefined) {
    pid = nextPortId++;
    ports.add(port);
    portIds.set(port, pid);
    portById.set(pid, port);
    replayJobs(port);
  }
  portLastSeen.set(pid, Date.now());
  switch (m.t) {
    case 'addJob': {
      // The editor uploads whatever the author picked, as-is — no transcode, so no MIME
      // routing. Every album upload still passes the one routing gate.
      const editor = m.purpose === 'editor';
      const route = editor ? null : routeByMime(m.mime);
      if (!editor && !route) {
        port.postMessage({
          t: 'jobStatus',
          jobId: m.jobId,
          purpose: m.purpose,
          fileName: m.fileName,
          phase: 'failed',
          error: 'unknown_mime',
        });
        return;
      }
      const rec: JobRec = {
        jobId: m.jobId,
        purpose: m.purpose,
        fileName: m.fileName,
        mime: m.mime,
        file: m.file,
        // Only the album leg reads `engine`; the editor never transcodes.
        engine: route?.engine ?? 'image',
        // The editor waits for nothing but the transfer: it never joins the image queue
        // nor the video token pool.
        phase: editor || route?.engine === 'image' ? 'queued' : 'lease-wait',
        opWritten: false,
        editorResultAcked: false,
        cancelled: false,
      };
      jobs.set(m.jobId, rec);
      owners.set(m.jobId, portIds.get(port)!);
      notify(rec);
      if (editor) {
        // No transcode leg for the editor — the picked file is uploaded as-is.
        void runEditorUpload(rec).catch((e) => failJob(rec, String((e as Error)?.message ?? e)));
        return;
      }
      if (route?.engine === 'image') {
        imageQueue.push(m.jobId);
        pumpImage();
      } else {
        videoQueue.push(m.jobId);
        pumpVideoLeases();
      }
      return;
    }
    case 'cancelJob': {
      const rec = jobs.get(m.jobId);
      if (!rec) return;
      rec.cancelled = true;
      // Cancel active transfers and release video leases.
      rec.uploadAbort?.abort();
      const owner = ownerPort(rec);
      const leaseId = rec.leaseId;
      forgetJob(m.jobId);
      if (leaseId) {
        leases.delete(leaseId);
        // ownerPort() already re-registered a swept port, so this posts to a live port.
        owner?.postMessage({ t: 'leaseRevoked', leaseId, jobId: m.jobId });
      }
      // Cancel is the one path that may drop the artifact: the job will never be
      // retried, so nothing else will ever read it again. The record goes with it, or the next
      // page load would rebuild the card from a photo the user deleted.
      if (rec.artifact) void removeArtifact(m.jobId, rec.artifact.ext);
      if (db && rec.sha256) void deletePhotoRecord(db, rec.sha256).catch(() => undefined);
      broadcast({ t: 'jobRemoved', jobId: m.jobId });
      return;
    }
    case 'retryJob':
      onRetry(m.jobId);
      return;
    case 'leaseHeartbeat': {
      const lease = leases.get(m.leaseId);
      if (lease) lease.lastBeat = Date.now();
      return;
    }
    case 'leaseVisibility': {
      const lease = leases.get(m.leaseId);
      if (lease) lease.hidden = m.hidden;
      return;
    }
    case 'leaseRelease': {
      const lease = leases.get(m.leaseId);
      if (lease) {
        leases.delete(m.leaseId);
        const rec = jobs.get(lease.jobId);
        if (rec && rec.leaseId === m.leaseId) rec.leaseId = undefined;
      }
      pumpVideoLeases();
      return;
    }
    case 'videoProgress': {
      const rec = jobs.get(m.jobId);
      // Ignore startup zeroes until video encoding reports measured progress.
      if (rec && m.fraction > 0) notify(rec, { fraction: clamp01(m.fraction) });
      return;
    }
    case 'videoResult': {
      const rec = jobs.get(m.jobId);
      if (rec && rec.phase === 'transcoding') onVideoResult(rec, m);
      else pumpVideoLeases();
      return;
    }
    case 'videoFailed': {
      const rec = jobs.get(m.jobId);
      if (rec && rec.phase === 'transcoding') onVideoFailed(rec, m.error);
      else pumpVideoLeases();
      return;
    }
    case 'opWritten': {
      const rec = jobs.get(m.jobId);
      if (rec) rec.opWritten = true;
      return;
    }
    case 'editorResultAck': {
      const rec = jobs.get(m.jobId);
      if (rec?.purpose === 'editor') rec.editorResultAcked = true;
      return;
    }
    case 'poolHint': {
      videoLimit = videoPoolSize(m);
      pumpVideoLeases();
      return;
    }
    case 'mediaHost': {
      mediaHostUrl = m.url;
      return;
    }
  }
}
