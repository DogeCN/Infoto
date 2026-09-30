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
} from '../../src/base/upload/pipeline.ts';

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

test('classifies uploads, translates errors, and builds independent operations', async () => {
  // Routing, pools, and upload limits.
  {
    assert.equal(WEBP_QUALITY, 0.95);
    assert.equal(VP9_QUANTIZER, 30);
    assert.equal(OPUS_BITRATE, 128_000);
    assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
    assert.equal(UPLOAD_TIMEOUT_MS, 45_000);
    assert.equal(isOversize(MAX_UPLOAD_BYTES), false);
    assert.equal(isOversize(MAX_UPLOAD_BYTES + 1), true);
    assert.equal(artifactExt('image'), 'webp');
    assert.equal(artifactExt('webm'), 'webm');

    assert.deepEqual(routeByMime('image/gif'), { kind: 'webm', engine: 'gif' });
    assert.deepEqual(routeByMime('IMAGE/GIF'), { kind: 'webm', engine: 'gif' });
    for (const mime of ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']) {
      assert.deepEqual(routeByMime(mime), { kind: 'webm', engine: 'video' });
    }
    for (const mime of ['image/webp', 'image/jpeg', 'image/heic', 'image/avif']) {
      assert.deepEqual(routeByMime(mime), { kind: 'image', engine: 'image' });
    }
    assert.deepEqual(routeByMime('image/webp; charset=binary'), { kind: 'image', engine: 'image' });
    for (const mime of ['', 'application/pdf', 'audio/mpeg', 'image', 'video']) {
      assert.equal(routeByMime(mime), null);
    }

    assert.equal(imagePoolSize(1), 2);
    assert.equal(imagePoolSize(4), 3);
    assert.equal(imagePoolSize(16), 6);
    assert.equal(imagePoolSize(), 3);
    assert.equal(imagePoolSize(Number.NaN), 3);
    assert.equal(imagePoolSize(16, 1.5), 2);
    assert.equal(imagePoolSize(16, 2), 6);
    assert.equal(videoPoolSize({ deviceMemory: 8, hardwareConcurrency: 2 }), 2);
    assert.equal(videoPoolSize({ deviceMemory: 4, hardwareConcurrency: 16 }), 1);
    assert.equal(videoPoolSize({ hardwareConcurrency: 8 }), 2);
    assert.equal(videoPoolSize({ hardwareConcurrency: 4 }), 1);
    assert.equal(videoPoolSize({}), 1);
    assert.equal(videoPoolSize({ deviceMemory: Number.NaN, hardwareConcurrency: 8 }), 2);
    assert.equal(videoPoolSize({ deviceMemory: 0, hardwareConcurrency: 4 }), 1);
    assert.equal(videoPoolSize({ deviceMemory: 64, hardwareConcurrency: 128 }), 2);
  }

  // GIF headers and failure text stay on the right leg.
  {
    assert.deepEqual(parseGifLsdSize(gifHeader(640, 480)), { width: 640, height: 480 });
    assert.deepEqual(parseGifLsdSize(gifHeader(200, 150, 0x37)), { width: 200, height: 150 });
    assert.equal(parseGifLsdSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(parseGifLsdSize(gifHeader(0, 100)), null);
    assert.equal(
      parseGifLsdSize(new Uint8Array([0x47, 0x49, 0x46, 0x39, 0x37, 0x61, 1, 0, 1, 0])),
      null,
    );
    assert.equal(
      translateTaskError('no_supported_video_codec', {}),
      'Transcode failed: Unsupported codec (no VP9/VP8 encoder available)',
    );
    assert.equal(
      translateTaskError('Input has an unsupported or unrecognizable format.', {}),
      'Transcode failed: Unrecognizable media format',
    );
    assert.equal(translateTaskError('weird_thing', {}), 'Transcode failed (weird_thing)');
    assert.equal(translateTaskError(undefined, {}), 'Transcode failed');
    assert.equal(
      translateTaskError('source_missing', {}),
      'Transcode failed: Source file has been cleared',
    );
    assert.equal(
      translateTaskError('oversize', { oversize: true, uploadLeg: true }),
      'Output exceeds the 100 MB upload limit',
    );
    assert.equal(translateTaskError('timeout', { uploadLeg: true }), 'Upload timed out');
    assert.equal(translateTaskError('http_500', { uploadLeg: true }), 'Upload failed (HTTP 500)');
    assert.equal(
      translateTaskError('unauthorized', { uploadLeg: true }),
      'Verify before uploading',
    );
    assert.equal(translateTaskError('whatever', { uploadLeg: true }), 'Upload failed');
  }

  // Upload ops are copied and ids do not collide.
  {
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
    assert.notEqual(op.payload, payload);
    const ids = new Set(Array.from({ length: 200 }, () => uid()));
    assert.equal(ids.size, 200);
  }
});
