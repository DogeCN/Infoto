import { describe, expect, it, vi } from 'vitest';
import { LeaseClient } from '../../src/transcode/lease';
import type { SwToPageMessage } from '../../src/transcode/protocol';
import { postSync } from '../../src/core/api/syncClient';
import { postUpload } from '../../src/core/api/uploadClient';

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('sync and upload clients', () => {
  it('classifies Turnstile and rate-limit failures without retrying, and bounds stalled requests', async () => {
    const required = vi
      .fn()
      .mockResolvedValue(
        okResponse({ ok: false, error: 'turnstile_required', turnstileSiteKey: 'key-1' }, 401),
      );
    await expect(
      postSync({ ops: [] }, { fetchFn: required, origin: 'http://x' }),
    ).rejects.toMatchObject({
      name: 'TurnstileRequiredError',
      turnstileSiteKey: 'key-1',
    });
    expect(Object.keys(JSON.parse(required.mock.calls[0]![1].body))).not.toContain('uuid');

    const failed = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: false, error: 'turnstile_failed' }, 401));
    await expect(
      postSync({ ops: [] }, { fetchFn: failed, origin: 'http://x' }),
    ).rejects.toMatchObject({
      name: 'TurnstileFailedError',
    });

    const body = {
      ok: true,
      serverTime: 1,
      selfId: 0,
      mediaHostUrl: 'https://facade.test',
      photos: [],
      announcements: [],
      polls: [],
      feedback: [],
    };
    const ok = vi.fn().mockResolvedValue(okResponse(body));
    expect((await postSync({ ops: [] }, { fetchFn: ok, origin: 'http://x' })).response).toEqual(
      body,
    );

    vi.useFakeTimers();
    try {
      const limited = vi.fn().mockResolvedValue(okResponse({ error: 'rate_limited' }, 429));
      await expect(postSync({ ops: [] }, { fetchFn: limited, origin: 'http://x' })).rejects.toThrow(
        'rate_limited',
      );
      await vi.advanceTimersByTimeAsync(120_000);
      expect(limited).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    const hanging = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    await expect(
      postSync(
        { ops: [] },
        { fetchFn: hanging as unknown as typeof fetch, origin: 'http://x', timeoutMs: 20 },
      ),
    ).rejects.toThrow(/sync_timeout/);

    const uploaded = vi.fn().mockResolvedValue(okResponse({ data: 'https://host/f.webp' }));
    expect(
      await postUpload(new Blob(['x'], { type: 'image/webp' }), {
        fetchFn: uploaded,
        mediaHostUrl: 'http://x',
      }),
    ).toEqual({ ok: true, url: 'https://host/f.webp' });
    expect(uploaded.mock.calls[0]![0]).toBe('http://x/upload');
    const denied = vi.fn().mockResolvedValue(okResponse({ error: 'unauthorized' }, 401));
    expect(
      await postUpload(new Blob(['x']), { fetchFn: denied, mediaHostUrl: 'http://x' }),
    ).toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    const slow = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    expect(
      await postUpload(new Blob(['x']), { fetchFn: slow, mediaHostUrl: 'http://x', timeoutMs: 10 }),
    ).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('heartbeats a held lease and stops after release or revocation', () => {
    const granted = (leaseId = 'l1'): SwToPageMessage => ({
      t: 'leaseGranted',
      leaseId,
      jobId: 'j1',
      file: new Blob(),
      mime: 'video/mp4',
      fileName: 'a.mp4',
    });
    const posted: unknown[] = [];
    const client = new LeaseClient(
      { postMessage: (m: unknown) => posted.push(m) },
      { onGranted: vi.fn(), onRevoked: vi.fn() },
    );
    client.release();
    expect(posted).toHaveLength(0);
    vi.useFakeTimers();
    client.handleMessage(granted());
    vi.advanceTimersByTime(12_000);
    expect(
      posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length,
    ).toBeGreaterThanOrEqual(2);
    client.release();
    expect(posted.some((m) => (m as { t: string }).t === 'leaseRelease')).toBe(true);
    const beatsAfter = posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length;
    vi.advanceTimersByTime(12_000);
    expect(posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length).toBe(
      beatsAfter,
    );
    vi.useRealTimers();
    client.handleMessage(granted());
    client.handleMessage({ t: 'leaseRevoked', leaseId: 'l1', jobId: 'j1' });
    expect(client.heldJobId).toBeNull();
  });
});
