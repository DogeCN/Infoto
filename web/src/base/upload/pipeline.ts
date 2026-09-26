// Upload pipeline — pure logic shared by the main thread, the SharedWorker
// scheduler and the page's top-level video DedicatedWorker. No DOM/browser
// APIs here: every function is runnable under Node for unit assertions.

import type { Op, UploadPayload } from '$shared/types';
import { copy, fmt } from '$shared/copy';

// ---- constants -------------------------------------------------------------

/** WebP quality for image transcoding. */
export const WEBP_QUALITY = 0.95;
/** VP9 constant-quality quantizer. */
export const VP9_QUANTIZER = 30;
/** Opus audio bitrate in bits per second. */
export const OPUS_BITRATE = 128_000;
/** Cloudflare request-body ceiling — artifacts above this never hit /upload. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Per-attempt upload deadline, measured as *silence*: the attempt fails only after
 *  this long with no progress at all — not a wall-clock cap, so a large artifact on
 *  a slow uplink keeps moving for minutes. */
export const UPLOAD_TIMEOUT_MS = 45_000;

// ---- file type routing (single exit point) ----------------------------------

// The hidden file input accepts `image/*,video/*`; routing below must cover exactly
// that surface — never a single-MIME bifurcation: image/gif and video/* → WebM pipeline,
// any other image/* → WebP pipeline, anything else → explicit rejection (unknown MIME).

/** Which transcoding engine a file goes through. */
export type TranscodeEngine = 'image' | 'video' | 'gif';
/** Artifact family: `webm` covers both video and GIF sources. */
export type MediaKind = 'image' | 'webm';

export interface RouteDecision {
  kind: MediaKind;
  engine: TranscodeEngine;
}

/** Single routing exit for picked files. Returns null for MIME types outside
 *  the `accept` surface (`image/*,video/*`) — callers must surface an error. */
export function routeByMime(mime: string): RouteDecision | null {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (m === 'image/gif') return { kind: 'webm', engine: 'gif' };
  if (m.startsWith('video/')) return { kind: 'webm', engine: 'video' };
  if (m.startsWith('image/')) return { kind: 'image', engine: 'image' };
  return null;
}

/** Artifact extension implied by the kind. */
export function artifactExt(kind: MediaKind): 'webp' | 'webm' {
  return kind === 'image' ? 'webp' : 'webm';
}

// ---- concurrency pools --------------------------------------------------------

/** Image pool: `clamp(2, 6, floor(hardwareConcurrency × 0.75))`; missing/invalid
 *  hardwareConcurrency falls back to 4; a reported downlink under 2 Mbps caps the
 *  pool at 2 (network is the bottleneck, not CPU). */
export function imagePoolSize(hardwareConcurrency?: number, downlinkMbps?: number): number {
  const cores =
    typeof hardwareConcurrency === 'number' &&
    Number.isFinite(hardwareConcurrency) &&
    hardwareConcurrency > 0
      ? hardwareConcurrency
      : 4;
  let cap = Math.min(6, Math.max(2, Math.floor(cores * 0.75)));
  if (typeof downlinkMbps === 'number' && Number.isFinite(downlinkMbps) && downlinkMbps < 2) {
    cap = Math.min(cap, 2);
  }
  return cap;
}

/** Video/GIF token pool size: deviceMemory ≥ 8 GB → 2, else 1; absent (Firefox/Safari)
 *  → hardwareConcurrency ≥ 8 ? 2 : 1; neither → 1. Hard cap 2 (video encoding freezes
 *  low-end devices); the page reports both readings via the poolHint message. */
export function videoPoolSize(nav: {
  deviceMemory?: unknown;
  hardwareConcurrency?: unknown;
}): number {
  const dm = nav.deviceMemory;
  if (typeof dm === 'number' && Number.isFinite(dm) && dm > 0) return dm >= 8 ? 2 : 1;
  const hc = nav.hardwareConcurrency;
  if (typeof hc === 'number' && Number.isFinite(hc) && hc > 0) return hc >= 8 ? 2 : 1;
  return 1;
}

// ---- stage-2 gates -------------------------------------------------------------

/** Oversize check runs before any /upload attempt; a hit fails the file directly. */
export function isOversize(bytes: number): boolean {
  return bytes > MAX_UPLOAD_BYTES;
}

// ---- GIF geometry fallback ---------------------------------------------------------

/** Logical Screen Descriptor size from the GIF header (bytes 6–9, little-endian),
 *  used when ImageDecoder's GIF track reports no codedWidth/codedHeight — undefined
 *  dimensions make isConfigSupported reject the config. Null for non-GIF/degenerate. */
export function parseGifLsdSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  // 'GIF87a' | 'GIF89a'
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (
    sig !== 'GIF' ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return null;
  }
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// ---- error summary translation (fully localized) ----------------------------

export interface TaskErrorContext {
  oversize?: boolean;
  /** Present once stage 1 finished — the failure then happened on upload. */
  sha256?: string;
}

const UPLOAD_ERROR_TEXT: Record<string, string> = {
  timeout: copy.upload.errors.timeout,
  network_error: copy.upload.errors.network,
  // The proxy answers 401 with a JSON body whose `error` field the client prefers
  // over the status code, so the code reaching here is `unauthorized` — map both.
  unauthorized: copy.upload.errors.unauthorized,
  http_401: copy.upload.errors.unauthorized,
  oversize: copy.upload.errors.oversize,
  http_413: copy.upload.errors.tooLarge,
};

const TRANSCODE_ERROR_TEXT: Record<string, string> = {
  no_supported_video_codec: copy.transcode.errors.noSupportedVideoCodec,
  no_video_track: copy.transcode.errors.noVideoTrack,
  webp_encode_unsupported: copy.transcode.errors.webpEncodeUnsupported,
  conversion_invalid: copy.transcode.errors.conversionInvalid,
  empty_output: copy.transcode.errors.emptyOutput,
  gif_decode_failed: copy.transcode.errors.gifDecodeFailed,
  gif_dimensions_unknown: copy.transcode.errors.gifDimensionsUnknown,
  source_unavailable: copy.transcode.errors.sourceUnavailable,
  source_missing: copy.transcode.errors.sourceMissing,
  canvas_2d_unavailable: copy.transcode.errors.canvas2dUnavailable,
};

/** Raw engine/browser messages (mediabunny, WebCodecs, OPFS…) arrive in English —
 *  match the common shapes before falling back to the generic "transcode failed"
 *  + detail summary. */
const TRANSCODE_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /unrecognizable format|unsupported or unrecognizable/i,
    copy.transcode.errors.unrecognizableFormat,
  ],
  [/no (primary )?video track/i, copy.transcode.errors.noVideoTrack],
  [/no.*audio.*encoder|audio.*not supported/i, copy.transcode.errors.audioCodec],
  [/encoder(?!.*supported).*error|encoding error/i, copy.transcode.errors.encoderError],
  [/corrupt|invalid (data|frame)|malformed/i, copy.transcode.errors.corrupt],
  [/decode|decoder/i, copy.transcode.errors.decodeFailed],
  [/not enough memory|out of memory/i, copy.transcode.errors.outOfMemory],
];

/** Fully-Chinese, user-facing summary of one task failure. Unknown transcode
 *  errors fall back to "transcode failed" with the raw detail appended. */
export function translateTaskError(error: string | undefined, ctx: TaskErrorContext): string {
  if (ctx.oversize) return copy.upload.errors.oversize;
  const e = error ?? '';
  if (ctx.sha256) {
    // Stage 1 already succeeded → the failure is on the upload leg.
    if (UPLOAD_ERROR_TEXT[e]) return UPLOAD_ERROR_TEXT[e]!;
    if (e.startsWith('http_')) return fmt(copy.upload.errors.httpFailed, { status: e.slice(5) });
    return copy.upload.errors.failed;
  }
  const mapped = TRANSCODE_ERROR_TEXT[e];
  if (mapped) return fmt(copy.transcode.errors.summary, { detail: mapped });
  for (const [re, text] of TRANSCODE_ERROR_PATTERNS) {
    if (re.test(e)) return fmt(copy.transcode.errors.summary, { detail: text });
  }
  return e ? fmt(copy.transcode.errors.withCode, { error: e }) : copy.transcode.errors.failed;
}

// ---- op construction -------------------------------------------------------------

/** Upload op written to the op-log once the host returns its `data` URL. */
export function buildUploadOp(payload: UploadPayload): Op {
  return { type: 'upload', target: null, payload: { ...payload } };
}

/** Short id for tasks / batches — no crypto guarantees needed. */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
