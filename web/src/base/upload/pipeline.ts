// Upload pipeline — pure logic shared by the main thread, the SharedWorker
// scheduler and the page's top-level video DedicatedWorker. No DOM/browser
// APIs here: every function is runnable under Node for unit assertions.

import type { Op, UploadPayload } from '$shared/types';

// ---- constants (spec: "图床上传代理", "上传管线") ------------------------------

/** WebP quality for image transcoding. */
export const WEBP_QUALITY = 0.95;
/** VP9 constant-quality quantizer. */
export const VP9_QUANTIZER = 30;
/** Opus audio bitrate in bits per second. */
export const OPUS_BITRATE = 128_000;
/** Cloudflare request-body ceiling — artifacts above this never hit /upload. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Per-attempt upload timeout; timeouts count as upload failure. */
export const UPLOAD_TIMEOUT_MS = 45_000;

// ---- file type routing (single exit point) ----------------------------------

// The hidden file input accepts `image/*,video/*`; routing below must cover
// exactly that surface — never a single-MIME bifurcation.
//   image/gif  | video/*          → WebM pipeline
//   image/* (anything else)       → WebP pipeline
//   anything else                 → explicit rejection (unknown MIME)

/** Which transcoding engine a file goes through. */
export type TranscodeEngine = 'image' | 'video' | 'gif';
/** Artifact family: `webm` covers both video and GIF sources. */
export type MediaKind = 'image' | 'webm';

export interface RouteDecision {
  kind: MediaKind;
  engine: TranscodeEngine;
}

/**
 * Single routing exit for picked files. Returns null for MIME types outside
 * the `accept` surface (`image/*,video/*`) — callers must surface an error.
 */
export function routeByMime(mime: string): RouteDecision | null {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (m === 'image/gif') return { kind: 'webm', engine: 'gif' };
  if (m.startsWith('video/')) return { kind: 'webm', engine: 'video' };
  if (m.startsWith('image/')) return { kind: 'image', engine: 'image' };
  return null;
}

/** Artifact extension implied by the kind (spec: type 隐含扩展名). */
export function artifactExt(kind: MediaKind): 'webp' | 'webm' {
  return kind === 'image' ? 'webp' : 'webm';
}

// ---- concurrency pools --------------------------------------------------------

/**
 * Image pool: `clamp(2, 6, floor(hardwareConcurrency × 0.75))`;
 * missing/invalid hardwareConcurrency falls back to 4; a reported downlink
 * under 2 Mbps caps the pool at 2 (network is the bottleneck, not CPU).
 */
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

/**
 * Video/GIF token pool size (spec: "架构"), decision order:
 * 1. deviceMemory present → ≥ 8 GB: 2 tokens; < 8 GB: 1 token
 * 2. deviceMemory absent (Firefox/Safari) → hardwareConcurrency ≥ 8: 2; < 8: 1
 * 3. both unavailable → 1 (conservative)
 * Hard cap is 2: video encoding is memory- and CPU-dense, higher concurrency
 * freezes low-end devices. deviceMemory is window-only, so the page reports
 * both readings to the SharedWorker (see the poolHint protocol message).
 */
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

/**
 * Logical Screen Descriptor size straight from the GIF header (bytes 6–9,
 * little-endian). Used when ImageDecoder's GIF track reports no
 * codedWidth/codedHeight (observed on some Chromium builds — undefined
 * dimensions make VideoEncoder.isConfigSupported reject the config).
 * Returns null for non-GIF data or degenerate sizes.
 */
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

// ---- error summary translation (全量中文化, revalidation fix #4) -----------------

export interface TaskErrorContext {
  oversize?: boolean;
  /** Present once stage 1 finished — the failure then happened on upload. */
  sha256?: string;
}

const UPLOAD_ERROR_TEXT: Record<string, string> = {
  timeout: '上传超时',
  network_error: '网络错误',
  http_401: '未授权，请先通过验证',
  http_413: '文件过大',
};

const TRANSCODE_ERROR_TEXT: Record<string, string> = {
  no_supported_video_codec: '不支持的编码（无可用 VP9/VP8 编码器）',
  no_video_track: '未找到视频轨',
  webp_encode_unsupported: '当前环境不支持 WebP 编码',
  conversion_invalid: '无法解析该媒体格式',
  empty_output: '转码产出为空',
  gif_decode_failed: 'GIF 解码失败',
  gif_dimensions_unknown: '无法确定 GIF 尺寸',
  source_unavailable: '源文件丢失',
  source_missing: '源文件已被清理',
  canvas_2d_unavailable: '无法创建画布',
};

/**
 * Raw engine/browser messages (mediabunny, WebCodecs, OPFS…) arrive in
 * English — match the common shapes before falling back to the generic
 * 「转码失败」+ detail summary.
 */
const TRANSCODE_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/unrecognizable format|unsupported or unrecognizable/i, '无法识别的媒体格式'],
  [/no (primary )?video track/i, '未找到视频轨'],
  [/no.*audio.*encoder|audio.*not supported/i, '不支持的音频编码'],
  [/encoder(?!.*supported).*error|encoding error/i, '编码器错误'],
  [/corrupt|invalid (data|frame)|malformed/i, '文件可能已损坏'],
  [/decode|decoder/i, '文件解码失败，可能已损坏'],
  [/not enough memory|out of memory/i, '内存不足'],
];

/**
 * Fully-Chinese, user-facing summary of one task failure. Unknown transcode
 * errors fall back to 「转码失败」 with the raw detail appended.
 */
export function translateTaskError(error: string | undefined, ctx: TaskErrorContext): string {
  if (ctx.oversize) return '产物超过 100MB，无法上传';
  const e = error ?? '';
  if (ctx.sha256) {
    // Stage 1 already succeeded → the failure is on the upload leg.
    if (UPLOAD_ERROR_TEXT[e]) return UPLOAD_ERROR_TEXT[e]!;
    if (e.startsWith('http_')) return `上传失败（HTTP ${e.slice(5)}）`;
    return '上传失败';
  }
  const mapped = TRANSCODE_ERROR_TEXT[e];
  if (mapped) return `转码失败：${mapped}`;
  for (const [re, text] of TRANSCODE_ERROR_PATTERNS) {
    if (re.test(e)) return `转码失败：${text}`;
  }
  return e ? `转码失败（${e}）` : '转码失败';
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
