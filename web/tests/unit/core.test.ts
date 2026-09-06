import { describe, expect, it } from 'vitest';
import {
	imagePoolSize,
	isOversize,
	routeByMime,
	retryDelayMs,
	MAX_UPLOAD_BYTES,
	UPLOAD_TIMEOUT_MS,
	MAX_UPLOAD_ATTEMPTS,
	artifactExt,
	parseGifLsdSize,
} from '$base/upload/pipeline';
import { toId36, fromId36, proxyUrl } from '$base/lib/id36';

describe('pipeline pure functions', () => {
	it('retry backoff is exponential (1s, 2s, 4s…)', () => {
		expect(retryDelayMs(0)).toBe(1000);
		expect(retryDelayMs(1)).toBe(2000);
		expect(retryDelayMs(2)).toBe(4000);
	});

	it('100MB gate sits strictly above the limit', () => {
		expect(isOversize(MAX_UPLOAD_BYTES)).toBe(false);
		expect(isOversize(MAX_UPLOAD_BYTES + 1)).toBe(true);
	});

	it('upload constants match the contract', () => {
		expect(UPLOAD_TIMEOUT_MS).toBe(45_000);
		expect(MAX_UPLOAD_ATTEMPTS).toBe(3);
	});

	it('image pool clamp(2,6,floor(cores*0.75)) with downlink cap', () => {
		expect(imagePoolSize(undefined)).toBe(3);
		expect(imagePoolSize(2)).toBe(2);
		expect(imagePoolSize(4)).toBe(3);
		expect(imagePoolSize(16)).toBe(6);
		expect(imagePoolSize(64)).toBe(6);
		expect(imagePoolSize(16, 1.5)).toBe(2);
		expect(imagePoolSize(16, 2)).not.toBe(2);
	});

	it('routing covers exactly the accept surface image/*,video/*', () => {
		expect(routeByMime('image/gif')).toEqual({ kind: 'webm', engine: 'gif' });
		expect(routeByMime('video/mp4')).toEqual({ kind: 'webm', engine: 'video' });
		expect(routeByMime('IMAGE/JPEG')).toEqual({ kind: 'image', engine: 'image' });
		expect(routeByMime('image/webp')).toEqual({ kind: 'image', engine: 'image' });
		expect(routeByMime('application/pdf')).toBeNull();
		expect(routeByMime('')).toBeNull();
		expect(routeByMime('image/png;charset=utf-8')).toEqual({ kind: 'image', engine: 'image' });
	});

	it('artifact extension is implied by kind', () => {
		expect(artifactExt('image')).toBe('webp');
		expect(artifactExt('webm')).toBe('webm');
	});

	it('GIF header LSD fallback parses bytes 6-9', () => {
		const gif = new Uint8Array(10);
		gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
		gif[6] = 0x20;
		gif[7] = 0x03; // width 800
		gif[8] = 0x58;
		gif[9] = 0x02; // height 600
		expect(parseGifLsdSize(gif)).toEqual({ width: 800, height: 600 });
		expect(parseGifLsdSize(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});

describe('id36', () => {
	it('round-trips ids at boundaries', () => {
		expect(toId36(7)).toBe('7');
		expect(toId36(35)).toBe('z');
		expect(toId36(36)).toBe('10');
		expect(fromId36('z')).toBe(35);
		expect(fromId36('10')).toBe(36);
		expect(fromId36('!')).toBeNull();
		expect(() => toId36(-1)).toThrow();
		expect(proxyUrl('https://x.cc', 7)).toBe('https://x.cc/l/7');
	});
});