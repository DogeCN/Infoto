import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { postUpload, type UploadResult } from '../../src/core/api/uploadClient';

class FakeUpload {
  onprogress: ((event: ProgressEvent) => void) | null = null;
  onload: (() => void) | null = null;
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

const MEDIA_HOST = 'https://upload.test';
const blob = new Blob(['x'], { type: 'image/webp' });

function call(xhr: FakeXhr, timeoutMs = 1_000): Promise<UploadResult> {
  return postUpload(blob, {
    mediaHostUrl: MEDIA_HOST,
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('postUpload: uses an idle watchdog, reports real progress, and names the part', async () => {
  const idle = new FakeXhr();
  const idleCall = call(idle);
  await vi.advanceTimersByTimeAsync(1_000);
  assert.equal(idle.timeout, 0);
  assert.deepEqual(await idleCall, {
    ok: false,
    error: 'timeout',
    detail: 'no progress before deadline',
  });
  assert.equal(idle.aborted, true);

  const deadline = new FakeXhr();
  const deadlineCall = call(deadline, 500);
  await vi.advanceTimersByTimeAsync(499);
  assert.equal(await snapshot(deadlineCall), undefined);
  await vi.advanceTimersByTimeAsync(1);
  const deadlineResult = await deadlineCall;
  assert.equal(deadlineResult.ok, false);
  if (!deadlineResult.ok) {
    assert.equal(deadlineResult.error, 'timeout');
  }

  const slow = new FakeXhr();
  const slowCall = call(slow, 1_000);
  slow.progress(1, 10);
  await vi.advanceTimersByTimeAsync(900);
  slow.progress(5, 10);
  await vi.advanceTimersByTimeAsync(900);
  assert.equal(await snapshot(slowCall), undefined);
  // Once the body is fully sent the attempt leaves the silence budget behind: the tail is the
  // facade relaying upstream and the upstream storing the artifact, with nothing left to move.
  slow.progress(10, 10);
  await vi.advanceTimersByTimeAsync(30_000);
  assert.equal(await snapshot(slowCall), undefined);
  slow.finish(200, JSON.stringify({ data: 'https://cdn.test/slow.webp' }));
  assert.deepEqual(await slowCall, { ok: true, url: 'https://cdn.test/slow.webp' });

  // The response wait has its own deadline, so a facade that never answers still fails.
  const silent = new FakeXhr();
  const silentCall = postUpload(blob, {
    mediaHostUrl: MEDIA_HOST,
    timeoutMs: 1_000,
    responseTimeoutMs: 4_000,
    xhrFactory: () => silent as unknown as XMLHttpRequest,
  });
  silent.progress(10, 10);
  await vi.advanceTimersByTimeAsync(3_999);
  assert.equal(await snapshot(silentCall), undefined);
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual(await silentCall, {
    ok: false,
    error: 'timeout',
    detail: 'no response before deadline',
  });
  assert.equal(silent.aborted, true);

  // `upload.onload` ends the body too, on an engine that sends no final 100% progress event.
  const uploaded = new FakeXhr();
  const uploadedCall = postUpload(blob, {
    mediaHostUrl: MEDIA_HOST,
    timeoutMs: 1_000,
    responseTimeoutMs: 5_000,
    xhrFactory: () => uploaded as unknown as XMLHttpRequest,
  });
  uploaded.progress(3, 10);
  uploaded.upload.onload?.();
  await vi.advanceTimersByTimeAsync(2_000);
  assert.equal(await snapshot(uploadedCall), undefined);
  uploaded.finish(200, JSON.stringify({ data: 'https://cdn.test/onload.webp' }));
  assert.deepEqual(await uploadedCall, { ok: true, url: 'https://cdn.test/onload.webp' });

  const fractions: number[] = [];
  const progressXhr = new FakeXhr();
  const progressCall = postUpload(blob, {
    mediaHostUrl: MEDIA_HOST,
    timeoutMs: 1_000,
    xhrFactory: () => progressXhr as unknown as XMLHttpRequest,
    onProgress: (f) => fractions.push(f),
  });
  progressXhr.progress(0, 0);
  progressXhr.progress(1, 4);
  progressXhr.progress(4, 4);
  assert.deepEqual(fractions, [0.25, 1]);
  progressXhr.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
  assert.deepEqual(await progressCall, { ok: true, url: 'https://cdn.test/a.webp' });

  const named = new FakeXhr();
  const namedCall = call(named);
  named.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
  await namedCall;
  assert.equal(((named.sentBody as FormData).get('file') as File).name, 'm.webp');
  const png = new FakeXhr();
  const pngCall = postUpload(new Blob(['x'], { type: 'image/png' }), {
    mediaHostUrl: MEDIA_HOST,
    timeoutMs: 1_000,
    xhrFactory: () => png as unknown as XMLHttpRequest,
  });
  png.finish(200, JSON.stringify({ data: 'https://cdn.test/a.png' }));
  await pngCall;
  assert.equal(((png.sentBody as FormData).get('file') as File).name, 'm.png');
  const explicit = new FakeXhr();
  const explicitCall = postUpload(new Blob(['x']), {
    mediaHostUrl: MEDIA_HOST,
    timeoutMs: 1_000,
    fileName: 'm.webm',
    xhrFactory: () => explicit as unknown as XMLHttpRequest,
  });
  explicit.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webm' }));
  await explicitCall;
  assert.equal(((explicit.sentBody as FormData).get('file') as File).name, 'm.webm');
});

test('postUpload: settles network, setup, cancellation, and late events exactly once', async () => {
  // Maps network, HTTP, cancel, and late responses without a second settle.
  {
    const thrown = new FakeXhr();
    thrown.sendShouldThrow = true;
    assert.deepEqual(await call(thrown), {
      ok: false,
      error: 'network_error',
      detail: String(new Error('sync send failure')),
    });

    const unauthorized = new FakeXhr();
    const unauthorizedCall = call(unauthorized);
    unauthorized.finish(401, JSON.stringify({ error: 'unauthorized', msg: 'not verified' }));
    assert.deepEqual(await unauthorizedCall, {
      ok: false,
      error: 'unauthorized',
      detail: 'not verified',
    });

    const unavailable = new FakeXhr();
    const unavailableCall = call(unavailable);
    unavailable.finish(503, 'upstream unavailable');
    // A body that is not the facade's JSON envelope carries no detail message.
    assert.deepEqual(await unavailableCall, { ok: false, error: 'http_503', detail: undefined });

    const late = new FakeXhr();
    const lateCall = call(late);
    await vi.advanceTimersByTimeAsync(1_000);
    late.finish(200, JSON.stringify({ data: 'https://cdn.test/late.webp' }));
    assert.deepEqual(await lateCall, {
      ok: false,
      error: 'timeout',
      detail: 'no progress before deadline',
    });

    const cancel = new FakeXhr();
    const ctrl = new AbortController();
    const cancelCall = postUpload(blob, {
      mediaHostUrl: MEDIA_HOST,
      timeoutMs: 60_000,
      signal: ctrl.signal,
      xhrFactory: () => cancel as unknown as XMLHttpRequest,
    });
    cancel.progress(1, 10);
    ctrl.abort();
    assert.deepEqual(await cancelCall, { ok: false, error: 'aborted', detail: 'cancelled' });

    const already = new FakeXhr();
    const aborted = new AbortController();
    aborted.abort();
    assert.deepEqual(
      await postUpload(blob, {
        mediaHostUrl: MEDIA_HOST,
        signal: aborted.signal,
        xhrFactory: () => already as unknown as XMLHttpRequest,
      }),
      { ok: false, error: 'aborted', detail: 'cancelled' },
    );
    assert.equal(already.sentBody, null);
  }

  // Does not start fetch for an already-cancelled upload.
  {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn();
    assert.deepEqual(
      await postUpload(blob, { signal: controller.signal, fetchFn, mediaHostUrl: MEDIA_HOST }),
      { ok: false, error: 'aborted', detail: 'cancelled' },
    );
    assert.equal(fetchFn.mock.calls.length, 0);
  }

  // Settles setup failures as upload errors.
  {
    const setupFailure = await postUpload(blob, {
      mediaHostUrl: MEDIA_HOST,
      xhrFactory: () => {
        throw new Error('unavailable');
      },
    });
    assert.equal(setupFailure.ok, false);
    if (!setupFailure.ok) {
      assert.equal(setupFailure.error, 'network_error');
    }
  }

  // Ignores progress events after completion.
  {
    vi.useFakeTimers();
    try {
      const xhr = new FakeXhr();
      const onProgress = vi.fn();
      const request = postUpload(blob, {
        mediaHostUrl: MEDIA_HOST,
        onProgress,
        xhrFactory: () => xhr as unknown as XMLHttpRequest,
      });
      xhr.finish(200, JSON.stringify({ data: 'https://cdn.test/a.webp' }));
      await request;
      xhr.progress(1, 2);
      assert.equal(onProgress.mock.calls.length, 0);
      assert.equal(vi.getTimerCount(), 0);
    } finally {
      vi.useRealTimers();
    }
  }
});

// The facade is a separate origin; leaking this site's session cookie to it would hand a
// stranger's upload our identity. Both transports must stay credential-free.
test('postUpload: targets the facade without sending credentials', async () => {
  const xhr = new FakeXhr();
  const request = postUpload(blob, {
    mediaHostUrl: MEDIA_HOST,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
  });
  assert.equal(xhr.url, `${MEDIA_HOST}/upload`);
  assert.equal(xhr.withCredentials, false);
  xhr.finish(200, JSON.stringify({ data: 'https://facade.test/m/abc.webp' }));
  assert.deepEqual(await request, { ok: true, url: 'https://facade.test/m/abc.webp' });

  const fetchFn = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: 'https://facade.test/m/x.webp' }), { status: 200 }),
    );
  await postUpload(blob, { mediaHostUrl: MEDIA_HOST, fetchFn });
  assert.equal(fetchFn.mock.calls[0]?.[0], `${MEDIA_HOST}/upload`);
  assert.equal((fetchFn.mock.calls[0]?.[1] as RequestInit).credentials, 'omit');
});
