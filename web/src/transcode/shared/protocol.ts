// Page ⇄ SharedWorker message protocol — single source of truth (contract:
// SharedWorker code drift risk).
// Four message families: request (page→SW) / response (SW→page) / progress /
// lease. Note: Blob is not Transferable — always structured-clone across
// workers, never put a Blob in a transfer list.

import type { MediaType } from '$shared/types';

// ---- job state machine --------------------------------------------------------

export type JobPurpose = 'album' | 'editor';

export type JobPhase =
  | 'queued'
  | 'lease-wait' // video/gif: waiting for a concurrency token
  | 'transcoding'
  | 'hashing'
  | 'duplicate' // sha256 cache hit, upload skipped
  | 'uploading'
  | 'done'
  | 'failed';

export interface JobMeta {
  width: number;
  height: number;
  size: number;
  /** photos.type semantics: 0 still image / 1 no-audio animated / 2 video with audio. */
  type: MediaType;
}

// ---- request: page → SharedWorker ---------------------------------------------

export interface AddJobRequest {
  t: 'addJob';
  /** Job id, unique within the page. */
  jobId: string;
  purpose: JobPurpose;
  fileName: string;
  mime: string;
  /** Structured-clone by reference; never in a transfer list. */
  file: Blob;
}

export interface CancelJobRequest {
  t: 'cancelJob';
  jobId: string;
}

/** Manual retry handle: re-enqueue a failed job (skips transcode when the artifact is still in OPFS). */
export interface RetryJobRequest {
  t: 'retryJob';
  jobId: string;
}

/** Video token lease heartbeat (5s). */
export interface LeaseHeartbeatRequest {
  t: 'leaseHeartbeat';
  leaseId: string;
}

export interface LeaseReleaseRequest {
  t: 'leaseRelease';
  leaseId: string;
}

/** Page-side video transcode progress (DedicatedWorker → page → SW). */
export interface VideoProgressRequest {
  t: 'videoProgress';
  jobId: string;
  /** 0–1. */
  fraction: number;
}

export interface VideoResultRequest {
  t: 'videoResult';
  jobId: string;
  /** WebM artifact. Structured clone, never in a transfer list. */
  blob: Blob;
  width: number;
  height: number;
  /** Whether the source media had an audio track (decides type=2). */
  hasAudio: boolean;
}

export interface VideoFailedRequest {
  t: 'videoFailed';
  jobId: string;
  error: string;
}

/** Page ack that the upload op is written to the op-log (SW stops re-notifying). */
export interface OpWrittenRequest {
  t: 'opWritten';
  jobId: string;
}

export interface EditorResultAckRequest {
  t: 'editorResultAck';
  jobId: string;
}

/**
 * Video token pool hint: the page reports its navigator readings on connect
 * (deviceMemory is window-only — the SW cannot see it). The SW computes the
 * pool size with the base videoPoolSize() pure function.
 */
export interface PoolHintRequest {
  t: 'poolHint';
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export type PageToSwMessage =
  | AddJobRequest
  | CancelJobRequest
  | RetryJobRequest
  | LeaseHeartbeatRequest
  | LeaseReleaseRequest
  | VideoProgressRequest
  | VideoResultRequest
  | VideoFailedRequest
  | OpWrittenRequest
  | EditorResultAckRequest
  | PoolHintRequest;

// ---- response / progress / lease: SharedWorker → page --------------------------

export interface JobStatusMessage {
  t: 'jobStatus';
  jobId: string;
  purpose: JobPurpose;
  /** Source file name — lets pages that didn't enqueue the job (cross-tab) label it. */
  fileName?: string;
  phase: JobPhase;
  /** 0–1 (transcoding / uploading). */
  fraction?: number;
  /** Image-host URL when done. */
  url?: string;
  /** Error code when failed. */
  error?: string;
  /** Metadata when done / duplicate. */
  meta?: JobMeta;
  /** Artifact sha256 when done / duplicate (for the op payload and dedupe registry). */
  sha256?: string;
}

/** Token grant: the page creates/reuses its per-page video worker on this. */
export interface LeaseGrantedMessage {
  t: 'leaseGranted';
  leaseId: string;
  jobId: string;
  /** Source file rides along (the SW queue holds a reference) for the page worker. */
  file: Blob;
  mime: string;
  fileName: string;
}

/** Forced token revocation (15s without heartbeat): the page's in-flight job was re-enqueued. */
export interface LeaseRevokedMessage {
  t: 'leaseRevoked';
  leaseId: string;
  jobId: string;
}

export interface JobRemovedMessage {
  t: 'jobRemoved';
  jobId: string;
}

export type SwToPageMessage =
  JobStatusMessage | LeaseGrantedMessage | LeaseRevokedMessage | JobRemovedMessage;

// ---- constants ---------------------------------------------------------------

/** Heartbeat interval. */
export const LEASE_HEARTBEAT_MS = 5_000;
/** Forced revocation threshold. */
export const LEASE_TIMEOUT_MS = 15_000;

// ---- runtime guards (protocol unit tests) ---------------------------------------

const PAGE_TYPES = new Set([
  'addJob',
  'cancelJob',
  'retryJob',
  'leaseHeartbeat',
  'leaseRelease',
  'videoProgress',
  'videoResult',
  'videoFailed',
  'opWritten',
  'editorResultAck',
  'poolHint',
]);
const SW_TYPES = new Set(['jobStatus', 'leaseGranted', 'leaseRevoked', 'jobRemoved']);
const JOB_PURPOSES = new Set<JobPurpose>(['album', 'editor']);

export function isPageToSw(m: unknown): m is PageToSwMessage {
  if (typeof m !== 'object' || m === null) return false;
  const message = m as { t?: string; purpose?: string };
  if (!PAGE_TYPES.has(message.t ?? '')) return false;
  return message.t !== 'addJob' || JOB_PURPOSES.has(message.purpose as JobPurpose);
}

export function isSwToPage(m: unknown): m is SwToPageMessage {
  if (typeof m !== 'object' || m === null) return false;
  const message = m as { t?: string; purpose?: string };
  if (!SW_TYPES.has(message.t ?? '')) return false;
  return message.t !== 'jobStatus' || JOB_PURPOSES.has(message.purpose as JobPurpose);
}
