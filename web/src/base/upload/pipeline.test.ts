// Node-side assertions for the pipeline's pure logic: type routing, concurrency
// pools, oversize gate, op shape.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  artifactExt,
  buildUploadOp,
  imagePoolSize,
  isOversize,
  MAX_UPLOAD_BYTES,
  OPUS_BITRATE,
  parseGifLsdSize,
  routeByMime,
  translateTaskError,
  uid,
  UPLOAD_TIMEOUT_MS,
  videoPoolSize,
  VP9_QUANTIZER,
  WEBP_QUALITY,
} from './pipeline.ts';

// ---- tuning constants -----------------------------------------------------------

test('tuning constants are exact', () => {
  assert.equal(WEBP_QUALITY, 0.95);
  assert.equal(VP9_QUANTIZER, 30);
  assert.equal(OPUS_BITRATE, 128_000);
  assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
  assert.equal(UPLOAD_TIMEOUT_MS, 45_000);
});

// ---- MIME routing: single exit, accept-aligned ---------------------------------

test('routeByMime: image/gif → WebM (gif engine)', () => {
  assert.deepEqual(routeByMime('image/gif'), { kind: 'webm', engine: 'gif' });
});

test('routeByMime: video/* containers all go to the WebM pipeline', () => {
  for (const mime of [
    'video/mp4',
    'video/quicktime', // .mov
    'video/webm',
    'video/x-matroska',
    'video/x-msvideo', // .avi
    'video/3gpp',
    'video/ogg',
    'video/x-flv',
  ]) {
    assert.deepEqual(routeByMime(mime), { kind: 'webm', engine: 'video' }, mime);
  }
});

test('routeByMime: other image/* (incl. animated webp / HEIC) → WebP pipeline', () => {
  for (const mime of [
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/avif',
    'image/bmp',
  ]) {
    assert.deepEqual(routeByMime(mime), { kind: 'image', engine: 'image' }, mime);
  }
});

test('routeByMime: unknown MIME is rejected (null → caller errors)', () => {
  for (const mime of ['', 'application/pdf', 'audio/mpeg', 'text/plain', 'image', 'video']) {
    assert.equal(routeByMime(mime), null, mime);
  }
});

test('routeByMime: parameters and casing are normalized', () => {
  assert.deepEqual(routeByMime('IMAGE/GIF'), { kind: 'webm', engine: 'gif' });
  assert.deepEqual(routeByMime('image/webp; charset=binary'), { kind: 'image', engine: 'image' });
});

// ---- artifact naming --------------------------------------------------------------

test('artifactExt maps kind to the product filename extension', () => {
  assert.equal(artifactExt('image'), 'webp');
  assert.equal(artifactExt('webm'), 'webm');
});

// ---- concurrency pools ---------------------------------------------------------------

test('imagePoolSize: clamp(2, 6, floor(hw × 0.75))', () => {
  assert.equal(imagePoolSize(1), 2); // floor(0.75) = 0 → clamped up to 2
  assert.equal(imagePoolSize(2), 2);
  assert.equal(imagePoolSize(4), 3);
  assert.equal(imagePoolSize(8), 6);
  assert.equal(imagePoolSize(16), 6); // clamped down to 6
});

test('imagePoolSize: missing / invalid hardwareConcurrency falls back to 4 cores', () => {
  assert.equal(imagePoolSize(), 3); // floor(4 × 0.75)
  assert.equal(imagePoolSize(undefined), 3);
  assert.equal(imagePoolSize(0), 3);
  assert.equal(imagePoolSize(Number.NaN), 3);
  assert.equal(imagePoolSize(-8), 3);
});

test('imagePoolSize: downlink under 2 Mbps caps the pool at 2', () => {
  assert.equal(imagePoolSize(16, 1.5), 2);
  assert.equal(imagePoolSize(16, 2), 6); // exactly 2 → no cap
  assert.equal(imagePoolSize(4, 0.5), 2);
});

// ---- video token pool (deviceMemory → hardwareConcurrency → 1) -------------------

test('videoPoolSize: deviceMemory wins when present (≥8 GB → 2, else 1)', () => {
  assert.equal(videoPoolSize({ deviceMemory: 8, hardwareConcurrency: 2 }), 2);
  assert.equal(videoPoolSize({ deviceMemory: 32, hardwareConcurrency: 2 }), 2); // Edge 32 GB machines
  assert.equal(videoPoolSize({ deviceMemory: 4, hardwareConcurrency: 16 }), 1);
  assert.equal(videoPoolSize({ deviceMemory: 0.5 }), 1);
});

test('videoPoolSize: hardwareConcurrency fallback (Firefox / Safari)', () => {
  assert.equal(videoPoolSize({ hardwareConcurrency: 8 }), 2);
  assert.equal(videoPoolSize({ hardwareConcurrency: 16 }), 2);
  assert.equal(videoPoolSize({ hardwareConcurrency: 4 }), 1);
});

test('videoPoolSize: both unreadable → conservative 1; invalid values skipped', () => {
  assert.equal(videoPoolSize({}), 1);
  assert.equal(videoPoolSize({ deviceMemory: Number.NaN, hardwareConcurrency: 8 }), 2);
  assert.equal(videoPoolSize({ deviceMemory: 0, hardwareConcurrency: 4 }), 1); // 0 is not a real reading
  assert.equal(videoPoolSize({ deviceMemory: -1, hardwareConcurrency: -4 }), 1);
});

// ---- oversize gate ---------------------------------------------------------------------

test('isOversize: strictly greater than 100 MB', () => {
  assert.equal(isOversize(MAX_UPLOAD_BYTES), false);
  assert.equal(isOversize(MAX_UPLOAD_BYTES + 1), true);
  assert.equal(isOversize(0), false);
});

// ---- GIF header geometry fallback (E2E fix #P1) ----------------------------------

const gifHeader = (w: number, h: number, version = 0x39): Uint8Array =>
  new Uint8Array([
    0x47,
    0x49,
    0x46,
    0x38,
    version,
    0x61,
    w & 0xff,
    (w >> 8) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    0,
    0,
  ]);

test('parseGifLsdSize: GIF87a/GIF89a little-endian logical screen size', () => {
  assert.deepEqual(parseGifLsdSize(gifHeader(200, 150)), { width: 200, height: 150 });
  assert.deepEqual(parseGifLsdSize(gifHeader(200, 150, 0x37)), { width: 200, height: 150 });
  // > 255 exercises the high byte
  assert.deepEqual(parseGifLsdSize(gifHeader(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(parseGifLsdSize(gifHeader(0x1234, 0x5678)), { width: 0x1234, height: 0x5678 });
});

test('parseGifLsdSize: rejects non-GIF data, short buffers, degenerate sizes', () => {
  assert.equal(parseGifLsdSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0])), null); // PNG
  assert.equal(parseGifLsdSize(new Uint8Array([0x47, 0x49, 0x46])), null); // truncated
  assert.equal(parseGifLsdSize(gifHeader(0, 100)), null);
  assert.equal(parseGifLsdSize(gifHeader(100, 0)), null);
  assert.equal(
    parseGifLsdSize(new Uint8Array([0x47, 0x49, 0x46, 0x39, 0x37, 0x61, 1, 0, 1, 0])),
    null,
  ); // bad version
});

// ---- error summary translation (revalidation fix #4) ---------------------------

test('translateTaskError: known transcode codes map to localized summaries', () => {
  assert.equal(
    translateTaskError('no_supported_video_codec', {}),
    'Transcode failed: Unsupported codec (no VP9/VP8 encoder available)',
  );
  assert.equal(translateTaskError('no_video_track', {}), 'Transcode failed: No video track found');
  assert.equal(
    translateTaskError('empty_output', {}),
    'Transcode failed: Transcoding produced no output',
  );
});

test('translateTaskError: raw English engine messages are matched by pattern', () => {
  assert.equal(
    translateTaskError('Input has an unsupported or unrecognizable format.', {}),
    'Transcode failed: Unrecognizable media format',
  );
  assert.equal(
    translateTaskError('Failed to decode frame', {}),
    'Transcode failed: Failed to decode the file — it may be corrupted',
  );
});

test('translateTaskError: unknown errors fall back to "Transcode failed" + detail', () => {
  assert.equal(translateTaskError('weird_thing', {}), 'Transcode failed (weird_thing)');
  assert.equal(translateTaskError(undefined, {}), 'Transcode failed');
});

test('translateTaskError: oversize wins over everything', () => {
  assert.equal(
    translateTaskError('oversize', { oversize: true, uploadLeg: true }),
    'Output exceeds 100MB and cannot be uploaded',
  );
});

test('translateTaskError: uploadLeg set → the failure is on the upload leg', () => {
  assert.equal(translateTaskError('timeout', { uploadLeg: true }), 'Upload timed out');
  assert.equal(translateTaskError('http_500', { uploadLeg: true }), 'Upload failed (HTTP 500)');
  assert.equal(translateTaskError('whatever', { uploadLeg: true }), 'Upload failed');
});

// ---- op construction ----------------------------------------------------------------------

test('buildUploadOp: upload op with null target and full payload copy', () => {
  const payload = {
    sha256: 'abc',
    url: 'https://host/x.webp',
    width: 10,
    height: 20,
    size: 123,
    type: 0 as const,
  };
  const op = buildUploadOp(payload);
  assert.equal(op.type, 'upload');
  assert.equal(op.target, null);
  assert.deepEqual(op.payload, payload);
  assert.notEqual(op.payload, payload); // defensive copy
});

// ---- ids --------------------------------------------------------------------------------------

test('uid: distinct, non-empty ids', () => {
  const ids = new Set(Array.from({ length: 200 }, () => uid()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(id.length > 0);
});
