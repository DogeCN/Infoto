import { describe, expect, it } from 'vitest';
import { keepalivePrefix, KEEPALIVE_BODY_LIMIT } from '../../src/core/engine';
import type { Op } from '$shared/types';

const like = (i: number): Op => ({ type: 'like', target: i, payload: null });
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('keepalivePrefix', () => {
  it('sends the longest prefix that fits the browser body cap', () => {
    expect(KEEPALIVE_BODY_LIMIT).toBe(65_536);
    const ops = [like(1), like(2), like(3)];
    const whole = keepalivePrefix(ops);
    expect(whole!.ops).toEqual(ops);
    expect(JSON.parse(whole!.body)).toEqual({ ops, locale: 'en-US' });
    expect(bytes(whole!.body)).toBeLessThanOrEqual(KEEPALIVE_BODY_LIMIT);

    const big: Op = {
      type: 'fb_create',
      target: null,
      payload: { contentMd: '测'.repeat(2000) + '🔥' },
    };
    const fit = keepalivePrefix([like(1), big, big, like(2)], 8_000);
    expect(fit!.ops).toEqual([like(1), big]);
    expect(bytes(fit!.body)).toBeLessThanOrEqual(8_000);
    expect(
      bytes(`{"ops":[${JSON.stringify(like(1))},${JSON.stringify(big)},${JSON.stringify(big)}]}`),
    ).toBeGreaterThan(8_000);

    const giant: Op = {
      type: 'fb_create',
      target: null,
      payload: { contentMd: 'x'.repeat(70_000) },
    };
    expect(keepalivePrefix([giant])).toBeNull();
    expect(keepalivePrefix([like(1), giant])!.ops).toEqual([like(1)]);
  });
});
