import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postUpload, type UploadResult } from '../../src/core/api/uploadClient';

class FakeUpload {
  onprogress: ((event: ProgressEvent) => void) | null = null;
}

class FakeXhr {
  readonly upload = new FakeUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = '';
  withCredentials = false;
  timeout = 0;
  method = '';
  url = '';
  sentBody: XMLHttpRequestBodyInit | null = null;
  aborted = false;
  sendShouldThrow = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: XMLHttpRequestBodyInit | null): void {
    if (this.sendShouldThrow) throw new Error('sync send failure');
    this.sentBody = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  finish(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

const ORIGIN = 'https://upload.test';
const blob = new Blob(['x'], { type: 'image/webp' });

function call(xhr: FakeXhr, timeoutMs = 1_000): Promise<UploadResult> {
  return postUpload(blob, {
    origin: ORIGIN,
    timeoutMs,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
  });
}

async function snapshot(p: Promise<UploadResult>): Promise<UploadResult | undefined> {
  let settled: UploadResult | undefined;
  void p.then((r) => (settled = r));
  await Promise.resolve();
  return settled;
}

describe('postUpload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses an idle watchdog, reports real progress, and names the part', async () => {
    const idle = new FakeXhr();
    const idleCall = call(idle);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(idle.timeout).toBe(0);
    expect(await idleCall).toEqual({
      ok: false,
      error: 'timeout',
      detail: 'no progress before deadline',
    });
    expect(idle.aborted).toBe(true);

    const deadline = new FakeXhr();
    const deadlineCall = call(deadline, 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(await snapshot(deadlineCall)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await deadlineCall).toMatchObject({ ok: false, error: 'timeout' });

    const slow = new FakeXhr();
    const slowCall = call(slow, 1_000);
    slow.progress(1, 10);
    await vi.advanceTimersByTimeAsync(900);
    slow.progress(5, 10);
    await vi.advanceTimersByTimeAsync(900);
    expect(await snapshot(slowCall)).toBeUndefined();
    slow.progress(10, 10);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await slowCall).toMatchObject({ ok: false, error: 'timeout' });

    const fractions: number[] = [];
    const progressXhr = new FakeXhr();
    const progressCall = postUpload(blob, {
      origin: ORIGIN,
      timeoutMs: 1_000,
      xhrFactory: () => progressXhr as unknown as XMLHttpRequest,
      onProgress: (f) => fractions.push(f),
    });
    progressXhr.progress(0, 0);
    progressXhr.progress(1, 4);
    progressXhr.progress(4, 4);
    expect(fractions).toEqual([0.25, 1]);
    progressXhr.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
    expect(await progressCall).toEqual({ ok: true, url: 'https://cdn.test/a.webp' });

    const named = new FakeXhr();
    const namedCall = call(named);
    named.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
    await namedCall;
    expect(((named.sentBody as FormData).get('file') as File).name).toBe('m.webp');
    const png = new FakeXhr();
    const pngCall = postUpload(new Blob(['x'], { type: 'image/png' }), {
      origin: ORIGIN,
      timeoutMs: 1_000,
      xhrFactory: () => png as unknown as XMLHttpRequest,
    });
    png.finish(200, JSON.stringify({ data: 'https://cdn.test/a.png' }));
    await pngCall;
    expect(((png.sentBody as FormData).get('file') as File).name).toBe('m.png');
    const explicit = new FakeXhr();
    const explicitCall = postUpload(new Blob(['x']), {
      origin: ORIGIN,
      timeoutMs: 1_000,
      fileName: 'm.webm',
      xhrFactory: () => explicit as unknown as XMLHttpRequest,
    });
    explicit.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webm' }));
    await explicitCall;
    expect(((explicit.sentBody as FormData).get('file') as File).name).toBe('m.webm');
  });

  it('maps network, HTTP, cancel, and late responses without a second settle', async () => {
    const thrown = new FakeXhr();
    thrown.sendShouldThrow = true;
    expect(await call(thrown)).toEqual({
      ok: false,
      error: 'network_error',
      detail: String(new Error('sync send failure')),
    });

    const unauthorized = new FakeXhr();
    const unauthorizedCall = call(unauthorized);
    unauthorized.finish(401, JSON.stringify({ error: 'unauthorized', msg: 'not verified' }));
    expect(await unauthorizedCall).toEqual({
      ok: false,
      error: 'unauthorized',
      detail: 'not verified',
    });

    const status = new FakeXhr();
    const statusCall = call(status);
    status.finish(503, 'upstream unavailable');
    expect(await statusCall).toEqual({ ok: false, error: 'http_503' });

    const late = new FakeXhr();
    const lateCall = call(late);
    await vi.advanceTimersByTimeAsync(1_000);
    late.finish(200, JSON.stringify({ data: 'https://cdn.test/late.webp' }));
    expect(await lateCall).toEqual({
      ok: false,
      error: 'timeout',
      detail: 'no progress before deadline',
    });

    const cancel = new FakeXhr();
    const ctrl = new AbortController();
    const cancelCall = postUpload(blob, {
      origin: ORIGIN,
      timeoutMs: 60_000,
      signal: ctrl.signal,
      xhrFactory: () => cancel as unknown as XMLHttpRequest,
    });
    cancel.progress(1, 10);
    ctrl.abort();
    expect(await cancelCall).toEqual({ ok: false, error: 'aborted', detail: 'cancelled' });

    const already = new FakeXhr();
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await postUpload(blob, {
        origin: ORIGIN,
        signal: aborted.signal,
        xhrFactory: () => already as unknown as XMLHttpRequest,
      }),
    ).toEqual({ ok: false, error: 'aborted', detail: 'cancelled' });
    expect(already.sentBody).toBeNull();
  });
});
