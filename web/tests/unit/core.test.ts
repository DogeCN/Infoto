import { describe, expect, it } from 'vitest';
import {
  imagePoolSize,
  isOversize,
  routeByMime,
  MAX_UPLOAD_BYTES,
  UPLOAD_TIMEOUT_MS,
  artifactExt,
  parseGifLsdSize,
  videoPoolSize,
} from '$base/upload/pipeline';
import { toId36, fromId36, proxyUrl } from '$base/lib/id36';
import { keepalivePrefix, KEEPALIVE_BODY_LIMIT } from '../../src/core/sync/engine';
import type { Op } from '$shared/types';

describe('pipeline pure functions', () => {
  it('100MB gate sits strictly above the limit', () => {
    expect(isOversize(MAX_UPLOAD_BYTES)).toBe(false);
    expect(isOversize(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });

  it('upload timeout matches the contract (no auto-retry anywhere)', () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(45_000);
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

  it('video token pool is dynamic 1-2 (deviceMemory → hardwareConcurrency → 1)', () => {
    expect(videoPoolSize({ deviceMemory: 8 })).toBe(2);
    expect(videoPoolSize({ deviceMemory: 4, hardwareConcurrency: 16 })).toBe(1);
    expect(videoPoolSize({ hardwareConcurrency: 8 })).toBe(2);
    expect(videoPoolSize({ hardwareConcurrency: 2 })).toBe(1);
    expect(videoPoolSize({})).toBe(1);
    // the contract hard-caps the pool at 2 no matter the hardware
    expect(videoPoolSize({ deviceMemory: 64, hardwareConcurrency: 128 })).toBe(2);
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

// ---- keepalive 64KB prefix rule (contract "/sync 协议 · 同步触发点") ------------

const like = (i: number): Op => ({ type: 'like', target: i, payload: null });
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('keepalivePrefix', () => {
  it('budget constant is the browser hard limit', () => {
    expect(KEEPALIVE_BODY_LIMIT).toBe(65_536);
  });

  it('takes the whole batch when it fits', () => {
    const ops = [like(1), like(2), like(3)];
    const fit = keepalivePrefix(ops);
    expect(fit).not.toBeNull();
    expect(fit!.ops).toEqual(ops);
    expect(JSON.parse(fit!.body)).toEqual({ ops });
    expect(bytes(fit!.body)).toBeLessThanOrEqual(KEEPALIVE_BODY_LIMIT);
  });

  it('cuts the longest fitting prefix, multi-byte payloads measured exactly', () => {
    // 4-byte emoji + a CJK-heavy ann body force real TextEncoder measuring
    // sizes: like≈38B, big≈6066B → like+big≈6115B fits 8KB, +big≈12182B does not
    const big: Op = {
      type: 'fb_create',
      target: null,
      payload: { contentMd: '测'.repeat(2000) + '🔥' },
    };
    const ops = [like(1), big, big, like(2)];
    const fit = keepalivePrefix(ops, 8_000);
    expect(fit).not.toBeNull();
    expect(fit!.ops).toEqual([like(1), big]);
    expect(bytes(fit!.body)).toBeLessThanOrEqual(8_000);
    // maximality: one more op would bust the budget
    expect(
      bytes(`{"ops":[${JSON.stringify(like(1))},${JSON.stringify(big)},${JSON.stringify(big)}]}`),
    ).toBeGreaterThan(8_000);
  });

  it('prefix keeps at least 1 op; a lone oversize op returns null', () => {
    const giant: Op = {
      type: 'ann_create',
      target: null,
      payload: { title: 't', contentMd: 'x'.repeat(70_000) },
    };
    expect(keepalivePrefix([giant])).toBeNull();
    // …but the same giant behind a small op never blocks the prefix
    const fit = keepalivePrefix([like(1), giant]);
    expect(fit!.ops).toEqual([like(1)]);
  });
});
