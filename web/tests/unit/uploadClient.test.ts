import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postUpload, type UploadResult } from '../../src/core/api/uploadClient';

class FakeUpload {
  onprogress: ((event: ProgressEvent) => void) | null = null;
}

/** Controllable XHR: the client must never rely on the browser's own deadline. */
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

/** Resolves with undefined while the attempt is still in flight. */
async function snapshot(p: Promise<UploadResult>): Promise<UploadResult | undefined> {
  let settled: UploadResult | undefined;
  void p.then((r) => (settled = r));
  await Promise.resolve();
  return settled;
}

describe('postUpload (XHR path)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never arms XHR.request timeout — the 45s budget is an idle watchdog', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr);
    await vi.advanceTimersByTimeAsync(1_000);
    // The whole-attempt timer is what killed large uploads mid-flight.
    expect(xhr.timeout).toBe(0);
    expect(await p).toEqual({
      ok: false,
      error: 'timeout',
      detail: 'no progress before deadline',
    });
    expect(xhr.aborted).toBe(true);
  });

  it('aborts only after the deadline passes with no progress at all', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr, 500);
    expect(await snapshot(p)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(499);
    expect(await snapshot(p)).toBeUndefined();
    expect(xhr.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('re-arms the watchdog on every progress event (slow links stay alive)', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr, 1_000);
    xhr.progress(1, 10);
    await vi.advanceTimersByTimeAsync(900);
    xhr.progress(5, 10);
    await vi.advanceTimersByTimeAsync(900);
    expect(await snapshot(p)).toBeUndefined();
    expect(xhr.aborted).toBe(false);
    xhr.progress(10, 10);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('reports clamped progress fractions to the overlay', async () => {
    const xhr = new FakeXhr();
    const fractions: number[] = [];
    const p = postUpload(blob, {
      origin: ORIGIN,
      timeoutMs: 1_000,
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
      onProgress: (f) => fractions.push(f),
    });
    xhr.progress(0, 0);
    xhr.progress(1, 4);
    xhr.progress(4, 4);
    expect(fractions).toEqual([0.25, 1]);
    xhr.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
    expect(await p).toEqual({ ok: true, url: 'https://cdn.test/a.webp' });
  });

  it('settles as network_error when send() throws instead of hanging forever', async () => {
    const xhr = new FakeXhr();
    xhr.sendShouldThrow = true;
    expect(await call(xhr)).toEqual({
      ok: false,
      error: 'network_error',
      detail: String(new Error('sync send failure')),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(xhr.aborted).toBe(false);
  });

  it('prefers the server body error over the status code (the 401 the UI shows)', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr);
    xhr.finish(401, JSON.stringify({ error: 'unauthorized', msg: 'not verified' }));
    expect(await p).toEqual({ ok: false, error: 'unauthorized', detail: 'not verified' });
  });

  it('maps a non-2xx body without a code to its status', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr);
    xhr.finish(503, 'upstream unavailable');
    expect(await p).toEqual({ ok: false, error: 'http_503' });
  });

  it('ignores a second settle after the watchdog already resolved', async () => {
    const xhr = new FakeXhr();
    const p = call(xhr);
    await vi.advanceTimersByTimeAsync(1_000);
    xhr.finish(200, JSON.stringify({ data: 'https://cdn.test/late.webp' }));
    expect(await p).toEqual({
      ok: false,
      error: 'timeout',
      detail: 'no progress before deadline',
    });
  });
});
