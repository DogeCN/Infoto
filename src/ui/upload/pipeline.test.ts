// Node-side assertions for the pipeline's pure logic (spec: "验证 · 本地"):
// type routing, concurrency pools, oversize gate, retry schedule, op shape.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	artifactExt,
	buildUploadOp,
	CODEC_PROBE_TIMEOUT_MS,
	imagePoolSize,
	isOversize,
	MAX_UPLOAD_ATTEMPTS,
	MAX_UPLOAD_BYTES,
	OPUS_BITRATE,
	parseGifLsdSize,
	retryDelayMs,
	routeByMime,
	TRANSCODE_RUN_IDLE_MS,
	translateTaskError,
	uid,
	UPLOAD_TIMEOUT_MS,
	VIDEO_POOL_SIZE,
	VP9_QUANTIZER,
	watchdogInit,
	watchdogNext,
	type WatchdogLimits,
	WEBP_QUALITY,
} from './pipeline.ts';

// ---- constants (spec "架构" / "阶段二") ---------------------------------------

test('spec constants are exact', () => {
	assert.equal(WEBP_QUALITY, 0.95);
	assert.equal(VP9_QUANTIZER, 30);
	assert.equal(OPUS_BITRATE, 128_000);
	assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
	assert.equal(UPLOAD_TIMEOUT_MS, 45_000);
	assert.equal(MAX_UPLOAD_ATTEMPTS, 3);
	assert.equal(VIDEO_POOL_SIZE, 1);
	assert.equal(CODEC_PROBE_TIMEOUT_MS, 5_000);
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
	for (const mime of ['image/webp', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/avif', 'image/bmp']) {
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

// ---- oversize gate ---------------------------------------------------------------------

test('isOversize: strictly greater than 100 MB', () => {
	assert.equal(isOversize(MAX_UPLOAD_BYTES), false);
	assert.equal(isOversize(MAX_UPLOAD_BYTES + 1), true);
	assert.equal(isOversize(0), false);
});

// ---- retry schedule ---------------------------------------------------------------------

test('retryDelayMs: exponential backoff 1s / 2s / 4s…', () => {
	assert.equal(retryDelayMs(0), 1000);
	assert.equal(retryDelayMs(1), 2000);
	assert.equal(retryDelayMs(2), 4000);
	assert.equal(retryDelayMs(-1), 1000); // never below the floor
});

// ---- GIF header geometry fallback (E2E fix #P1) ----------------------------------

const gifHeader = (w: number, h: number, version = 0x39): Uint8Array =>
	new Uint8Array([0x47, 0x49, 0x46, 0x38, version, 0x61, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff, 0, 0]);

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
	assert.equal(parseGifLsdSize(new Uint8Array([0x47, 0x49, 0x46, 0x39, 0x37, 0x61, 1, 0, 1, 0])), null); // bad version
});

// ---- nested-transcode watchdog state machine (revalidation fix #5) ---------

const LIMITS: WatchdogLimits = { probeMs: 4_000, runIdleMs: 45_000 };

test('watchdog: probe-ok enters the run leg and resets the activity clock', () => {
	const s0 = watchdogInit(1000);
	assert.equal(s0.phase, 'probe');
	const r = watchdogNext(s0, { t: 'probe-ok', at: 1200 }, LIMITS);
	assert.deepEqual(r.state, { phase: 'run', lastActivity: 1200 });
	assert.equal(r.action, 'none');
});

test('watchdog: probe timeout / probe-fail → degrade', () => {
	const s0 = watchdogInit(1000);
	const timeout = watchdogNext(s0, { t: 'tick', at: 1000 + LIMITS.probeMs }, LIMITS);
	assert.equal(timeout.action, 'degrade');
	assert.equal(timeout.state.phase, 'degraded');
	// a tick before the deadline is a silent no-op
	assert.equal(watchdogNext(s0, { t: 'tick', at: 1000 + LIMITS.probeMs - 1 }, LIMITS).action, 'none');
	assert.equal(watchdogNext(s0, { t: 'probe-fail' }, LIMITS).action, 'degrade');
});

test('watchdog: run progress refreshes the silence window; idle beyond it degrades', () => {
	let s = watchdogNext(watchdogInit(0), { t: 'probe-ok', at: 1000 }, LIMITS).state;
	// progress at t=20000 restarts the window…
	s = watchdogNext(s, { t: 'progress', at: 20_000 }, LIMITS).state;
	assert.equal(s.lastActivity, 20_000);
	// …so a tick just short of runIdleMs after the LAST progress stays alive
	assert.equal(watchdogNext(s, { t: 'tick', at: 20_000 + TRANSCODE_RUN_IDLE_MS - 1 }, LIMITS).action, 'none');
	// …but silence for the full window degrades
	const hung = watchdogNext(s, { t: 'tick', at: 20_000 + TRANSCODE_RUN_IDLE_MS }, LIMITS);
	assert.equal(hung.action, 'degrade');
	assert.equal(hung.state.phase, 'degraded');
});

test('watchdog: result settles the run leg', () => {
	const s = watchdogNext(watchdogInit(0), { t: 'probe-ok', at: 10 }, LIMITS).state;
	const r = watchdogNext(s, { t: 'result' }, LIMITS);
	assert.equal(r.action, 'settle');
	assert.equal(r.state.phase, 'settled');
});

test('watchdog: terminal phases ignore late events — the two watchdogs never interfere', () => {
	const degraded = watchdogNext(watchdogInit(0), { t: 'probe-fail' }, LIMITS).state;
	// the run watchdog's late tick / late progress / stray result: all no-ops
	assert.equal(watchdogNext(degraded, { t: 'tick', at: 999_999 }, LIMITS).action, 'none');
	assert.equal(watchdogNext(degraded, { t: 'progress', at: 5 }, LIMITS).action, 'none');
	assert.equal(watchdogNext(degraded, { t: 'result' }, LIMITS).action, 'none');
	assert.equal(watchdogNext(degraded, { t: 'probe-ok', at: 5 }, LIMITS).action, 'none');
	// settled likewise absorbs a late probe tick
	const settled = watchdogNext(watchdogNext(watchdogInit(0), { t: 'probe-ok', at: 1 }, LIMITS).state, { t: 'result' }, LIMITS).state;
	assert.equal(watchdogNext(settled, { t: 'tick', at: 10_000 }, LIMITS).action, 'none');
	assert.equal(watchdogNext(settled, { t: 'probe-fail' }, LIMITS).action, 'none');
});

test('watchdog: a late probe tick after the run leg started is a no-op', () => {
	// probe-ok at 1200 refreshes the clock, so the 4 s probe deadline computed
	// from run activity does not fire
	const s = watchdogNext(watchdogInit(0), { t: 'probe-ok', at: 1_200 }, LIMITS).state;
	const r = watchdogNext(s, { t: 'tick', at: 4_500 }, LIMITS);
	assert.equal(r.action, 'none');
	assert.equal(r.state.phase, 'run');
});

test('watchdog: ignored events never change the phase', () => {
	const s0 = watchdogInit(0);
	assert.equal(watchdogNext(s0, { t: 'result' }, LIMITS).state.phase, 'probe');
	assert.equal(watchdogNext(s0, { t: 'progress', at: 1 }, LIMITS).state.phase, 'probe');
});

// ---- error summary translation (revalidation fix #4) ---------------------------

test('translateTaskError: known transcode codes map to Chinese summaries', () => {
	assert.equal(translateTaskError('no_supported_video_codec', {}), '转码失败：不支持的编码（无可用 VP9/VP8 编码器）');
	assert.equal(translateTaskError('no_video_track', {}), '转码失败：未找到视频轨');
	assert.equal(translateTaskError('empty_output', {}), '转码失败：转码产出为空');
});

test('translateTaskError: raw English engine messages are matched by pattern', () => {
	assert.equal(
		translateTaskError('Input has an unsupported or unrecognizable format.', {}),
		'转码失败：无法识别的媒体格式',
	);
	assert.equal(translateTaskError('Failed to decode frame', {}), '转码失败：文件解码失败，可能已损坏');
});

test('translateTaskError: unknown errors fall back to 「转码失败」 + detail', () => {
	assert.equal(translateTaskError('weird_thing', {}), '转码失败（weird_thing）');
	assert.equal(translateTaskError(undefined, {}), '转码失败');
});

test('translateTaskError: oversize wins over everything', () => {
	assert.equal(translateTaskError('oversize', { oversize: true, sha256: 'abc' }), '产物超过 100MB，无法上传');
});

test('translateTaskError: sha256 present → the failure is on the upload leg', () => {
	assert.equal(translateTaskError('timeout', { sha256: 'abc' }), '上传超时');
	assert.equal(translateTaskError('http_500', { sha256: 'abc' }), '上传失败（HTTP 500）');
	assert.equal(translateTaskError('whatever', { sha256: 'abc' }), '上传失败');
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
