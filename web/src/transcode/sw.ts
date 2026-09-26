// SharedWorker entry — transcode queue / image pool / video token pool / heartbeat leases.
// Neither WebCodecs nor the Worker constructor exists in this global, so image transcoding runs on this thread by importing image.worker.ts as a module;
// video jobs are only dispatched here — actual transcoding happens in the page's top-level DedicatedWorker.

import type { MediaType } from '$shared/types';
import {
  artifactExt,
  imagePoolSize,
  isOversize,
  routeByMime,
  videoPoolSize,
} from '$base/upload/pipeline';
import { postUpload } from '../core/api/uploadClient';
import { lookupSha } from '../core/oplog/cache';
import { openOplogDb } from '../core/oplog/store';
import { readArtifact, removeArtifact, storeArtifact } from './opfs';
import { transcodeImage } from './image.worker';
import { shouldDedupeArtifact } from './uploadPurpose';
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
  for (const p of ports) p.postMessage(m);
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
  error?: string;
  /** The upload op has been written to the op-log by some page. */
  opWritten: boolean;
  editorResultAcked: boolean;
  /** Cancellation flag for image jobs. */
  cancelled: boolean;
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

// ---- lease pool ----------------------------------------------------------------

interface Lease {
  leaseId: string;
  jobId: string;
  port: MessagePort;
  lastBeat: number;
}
const leases = new Map<string, Lease>();

/**
 * Global video concurrency (1–2): computed from the SW's own navigator at startup, then refined by each page's poolHint (deviceMemory is window-only); pages on one machine report identical readings, so last-write-wins updates are exact in practice.
 */
let videoLimit = videoPoolSize('navigator' in self ? navigator : {});

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function notify(rec: JobRec, extra: Partial<JobStatusMessage> = {}): void {
  // Cancelled jobs (record already deleted from `jobs`) stay silent — otherwise
  // late progress/result notifications would resurrect the row they just dropped.
  if (rec.cancelled) return;
  const message: JobStatusMessage = {
    t: 'jobStatus',
    jobId: rec.jobId,
    purpose: rec.purpose,
    fileName: rec.fileName,
    phase: rec.phase,
    url: rec.url,
    error: rec.error,
    meta: rec.meta,
    sha256: rec.sha256,
    ...extra,
  };
  if (rec.purpose === 'editor' && (rec.phase === 'done' || rec.phase === 'failed')) {
    if (!rec.editorResultAcked) ownerPort(rec)?.postMessage(message);
    return;
  }
  broadcast(message);
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
      rec.phase = 'failed';
      rec.error = 'source_unavailable';
      notify(rec);
      continue;
    }
    const leaseId = uid();
    rec.phase = 'transcoding';
    rec.leaseId = leaseId;
    leases.set(leaseId, { leaseId, jobId, port, lastBeat: Date.now() });
    port.postMessage({
      t: 'leaseGranted',
      leaseId,
      jobId,
      file: rec.file,
      mime: rec.mime,
      fileName: rec.fileName,
    });
    notify(rec, { fraction: 0 });
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
/**
 * Silence from a port that holds a lease: a live page heartbeats every 5s and stays well inside this even under background timer throttling (≈1/min), while a closed tab says nothing at all — distinguishes a gone page from a throttled one.
 */
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
  notify(rec, { fraction: 0 });
  try {
    const r = await transcodeImage(rec.file);
    if (rec.cancelled) return;
    if (!r.ok) {
      rec.phase = 'failed';
      rec.error = r.error;
      notify(rec);
      return;
    }
    rec.phase = 'hashing';
    notify(rec);
    const { sha256, bytes } = await storeArtifact(rec.jobId, r.blob, 'webp');
    if (rec.cancelled) return;
    rec.sha256 = sha256;
    rec.meta = { width: r.width, height: r.height, size: bytes, type: 0 };
    rec.artifact = { ext: 'webp', size: bytes };
    await afterStage1(rec);
  } catch (e) {
    rec.phase = 'failed';
    rec.error = String((e as Error)?.message ?? e);
    notify(rec);
  }
}

// ---- stage 1 done: dedupe → stage 2 ------------------------------------------------

async function afterStage1(rec: JobRec): Promise<void> {
  // Existing photo hashes do not provide editor image URLs.
  if (shouldDedupeArtifact(rec.purpose)) {
    if (!db) db = await openOplogDb().catch(() => null as unknown as IDBDatabase);
    if (db && rec.sha256) {
      const hit = await lookupSha(db, 'album', rec.sha256).catch(() => undefined);
      if (hit) {
        rec.phase = 'duplicate';
        notify(rec);
        return;
      }
    }
  }
  rec.phase = 'uploading';
  notify(rec, { fraction: 0 });
  await runUpload(rec);
}

/** Stage 2: 100MB pre-check + one /upload attempt, no auto-retry — a failure marks
 *  the file, the artifact stays in OPFS, and retryJob is manual-only. */
async function runUpload(rec: JobRec): Promise<void> {
  const ext = artifactExt(rec.meta!.type === 0 ? 'image' : 'webm');
  const blob = await readArtifact(rec.jobId, ext);
  if (rec.cancelled) return;
  if (!blob) {
    rec.phase = 'failed';
    rec.error = 'source_unavailable';
    notify(rec);
    return;
  }
  // >100MB fails immediately; the artifact stays in OPFS (size limit)
  if (isOversize(blob.size)) {
    rec.phase = 'failed';
    rec.error = 'oversize';
    notify(rec);
    return;
  }
  const r = await postUpload(blob, {
    origin: self.location.origin,
    onProgress: (fraction) => notify(rec, { fraction }),
  });
  // Cancelled mid-upload: discard the result — no URL, no op write, no notify
  // (a photo whose owner cancelled must never land in the album).
  if (rec.cancelled) return;
  if (r.ok) {
    rec.url = r.url;
    rec.phase = 'done';
    notify(rec);
    return;
  }
  rec.phase = 'failed';
  rec.error = r.error;
  notify(rec);
}

// ---- video: page callbacks ---------------------------------------------------------

function onVideoResult(
  rec: JobRec,
  blob: Blob,
  width: number,
  height: number,
  hasAudio: boolean,
): void {
  if (rec.leaseId) leases.delete(rec.leaseId);
  void (async () => {
    try {
      const type: MediaType = hasAudio ? 2 : 1;
      rec.phase = 'hashing';
      notify(rec);
      const { sha256, bytes } = await storeArtifact(rec.jobId, blob, 'webm');
      rec.sha256 = sha256;
      rec.meta = { width, height, size: bytes, type };
      rec.artifact = { ext: 'webm', size: bytes };
      await afterStage1(rec);
    } catch (e) {
      rec.phase = 'failed';
      rec.error = String((e as Error)?.message ?? e);
      notify(rec);
    } finally {
      pumpVideoLeases();
    }
  })();
}

function onVideoFailed(rec: JobRec, error: string): void {
  if (rec.leaseId) leases.delete(rec.leaseId);
  rec.phase = 'failed';
  rec.error = error;
  notify(rec);
  pumpVideoLeases();
}

/** Manual retry handle: re-enqueue a failed job; skip transcode when the artifact is already in OPFS. */
function onRetry(jobId: string): void {
  const rec = jobs.get(jobId);
  if (!rec) {
    // The record was reclaimed (or cancelled elsewhere) while the card was still
    // up — tell every holder to drop it, otherwise the retry button dead-ends.
    broadcast({ t: 'jobRemoved', jobId });
    return;
  }
  if (rec.phase !== 'failed' && rec.phase !== 'done') return;
  rec.error = undefined;
  rec.url = undefined;
  rec.opWritten = false;
  rec.editorResultAcked = false;
  rec.cancelled = false;
  if (rec.artifact && rec.sha256) {
    // artifact already on disk: go straight to dedupe/upload
    rec.phase = 'uploading';
    notify(rec, { fraction: 0 });
    void runUpload(rec);
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

// ---- lease reaper (force-revoke after 15s without a heartbeat) -----------------------

setInterval(() => {
  const now = Date.now();
  for (const [leaseId, lease] of leases) {
    if (now - lease.lastBeat > LEASE_TIMEOUT_MS) {
      leases.delete(leaseId);
      const rec = jobs.get(lease.jobId);
      if (rec && rec.leaseId === leaseId) {
        const pid = owners.get(rec.jobId);
        const seen = pid === undefined ? 0 : (portLastSeen.get(pid) ?? 0);
        if (pid === undefined || now - seen > DEAD_OWNER_MS) {
          // The owning page stopped talking long before its lease did — closed, not throttled.
          // Re-enqueueing would pin the token pool (top of 2) forever, blocking every other
          // video upload; drop the job instead and let each page clean up its own row.
          forgetJob(rec.jobId);
          continue;
        }
        rec.leaseId = undefined;
        rec.phase = 'lease-wait';
        // in-flight job re-enqueues (transcoding is idempotent; OPFS artifact sha256 dedupe backstops)
        videoQueue.push(rec.jobId);
        lease.port.postMessage({ t: 'leaseRevoked', leaseId, jobId: lease.jobId });
        notify(rec);
        pumpVideoLeases();
      }
    }
  }
}, 2_000);

/**
 * Terminal-job housekeeping: each job's source Blob (a picked video can be gigabytes) and its record (useful only for refresh replay and manual retry) grow without bound otherwise; it runs on the lease reaper's clock so long-lived sessions stay flat.
 */
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
  // Album jobs replay for refresh recovery; editor results stay with the original owner
  // and never cross a page-reload boundary. Terminal album states are skipped: /sync
  // already delivers `done` photos and a duplicate never landed at all.
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
};

function handleMessage(port: MessagePort, m: PageToSwMessage): void {
  // Liveness stamp (lease reaper / port sweep read it), and re-registration for a
  // port that was swept while its page sat idle — it must be back in `ports`
  // before anything is posted to it.
  let pid = portIds.get(port);
  if (pid === undefined) {
    pid = nextPortId++;
    ports.add(port);
    portIds.set(port, pid);
    portById.set(pid, port);
  }
  portLastSeen.set(pid, Date.now());
  switch (m.t) {
    case 'addJob': {
      const route = routeByMime(m.mime);
      if (!route) {
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
        engine: route.engine,
        phase: route.engine === 'image' ? 'queued' : 'lease-wait',
        opWritten: false,
        editorResultAcked: false,
        cancelled: false,
      };
      jobs.set(m.jobId, rec);
      owners.set(m.jobId, portIds.get(port)!);
      notify(rec);
      if (route.engine === 'image') {
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
      forgetJob(m.jobId);
      if (rec.leaseId) leases.delete(rec.leaseId);
      // Cancel is the one path that may drop the artifact: the job will never be
      // retried, so nothing else will ever read it again.
      if (rec.artifact) void removeArtifact(m.jobId, rec.artifact.ext);
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
      if (rec) notify(rec, { fraction: Math.max(0, Math.min(1, m.fraction)) });
      return;
    }
    case 'videoResult': {
      const rec = jobs.get(m.jobId);
      if (rec && rec.phase === 'transcoding')
        onVideoResult(rec, m.blob, m.width, m.height, m.hasAudio);
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
  }
}
