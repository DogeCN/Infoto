import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8');

class TestRequest {
  url: string;
  headers: Headers;
  destination: string;
  mode: string;
  credentials: string;

  constructor(input: string | TestRequest, init: RequestInit = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.headers = new Headers(
      init.headers ?? (typeof input === 'string' ? undefined : input.headers),
    );
    this.destination = typeof input === 'string' ? '' : input.destination;
    this.mode = init.mode ?? (typeof input === 'string' ? 'cors' : input.mode);
    this.credentials =
      init.credentials ?? (typeof input === 'string' ? 'same-origin' : input.credentials);
  }
}

interface TestResponse {
  type: string;
  ok: boolean;
  status: number;
  clone: () => TestResponse;
}

interface TestEvent {
  request?: TestRequest;
  respondWith?: (response: Promise<TestResponse>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
}

function opaqueResponse(): TestResponse {
  return {
    type: 'opaque',
    ok: false,
    status: 0,
    clone: opaqueResponse,
  };
}

function serviceWorker(fetchFn: (request: TestRequest) => Promise<TestResponse>) {
  const listeners = new Map<string, (event: TestEvent) => void>();
  const entries = new Map<string, TestResponse>();
  const deleted: string[] = [];
  const cache = {
    match: async (request: TestRequest) => entries.get(request.url),
    put: async (request: TestRequest, response: TestResponse) => {
      entries.set(request.url, response);
    },
    add: async () => undefined,
  };
  const storage = {
    open: async () => cache,
    match: async (request: string) => entries.get(request),
    keys: async () => ['infoto-assets-v1', 'infoto-media-v1', 'obsolete-cache'],
    delete: async (key: string) => {
      deleted.push(key);
      return true;
    },
  };
  const self = {
    location: { origin: 'https://album.test' },
    clients: { claim: async () => undefined },
    addEventListener: (type: string, listener: (event: TestEvent) => void) =>
      listeners.set(type, listener),
    skipWaiting: async () => undefined,
  };
  runInNewContext(source, {
    self,
    caches: storage,
    Request: TestRequest,
    Headers,
    URL,
    fetch: fetchFn,
    console: { warn: () => undefined },
    Promise,
    Map,
    Set,
  });
  return {
    entries,
    deleted,
    dispatchFetch(request: TestRequest) {
      let responsePromise: Promise<TestResponse> | undefined;
      const waiters: Promise<unknown>[] = [];
      listeners.get('fetch')!({
        request,
        respondWith: (response: Promise<TestResponse>) => (responsePromise = response),
        waitUntil: (promise: Promise<unknown>) => waiters.push(promise),
      });
      return {
        response: responsePromise,
        done: () => Promise.all(waiters),
      };
    },
    async activate() {
      let waiting: Promise<unknown> | undefined;
      listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => (waiting = promise) });
      await waiting;
    },
  };
}

test('service worker: caches and serves opaque cross-origin media offline', async () => {
  let fetchCount = 0;
  let offline = false;
  const sw = serviceWorker(async () => {
    fetchCount++;
    if (offline) throw new Error('offline');
    return opaqueResponse();
  });
  const request = new TestRequest('https://media.test/photo.webp', {
    mode: 'no-cors',
  });
  request.destination = 'image';

  const first = sw.dispatchFetch(request);
  assert.equal((await first.response)?.type, 'opaque');
  await first.done();
  assert.equal(sw.entries.has(request.url), true, 'opaque response is persisted in CacheStorage');

  offline = true;
  const second = sw.dispatchFetch(request);
  assert.equal(await second.response, sw.entries.get(request.url));
  await second.done();
  assert.equal(fetchCount, 1, 'cached media is served without a network request');
});

test('service worker: range media requests fetch a full no-CORS response for offline playback', async () => {
  let sent: TestRequest | undefined;
  const sw = serviceWorker(async (request) => {
    sent = request;
    return opaqueResponse();
  });
  const request = new TestRequest('https://media.test/clip.webm', {
    mode: 'no-cors',
    headers: { Range: 'bytes=0-1023' },
  });
  request.destination = 'video';

  const result = sw.dispatchFetch(request);
  assert.equal((await result.response)?.type, 'opaque');
  await result.done();
  assert.ok(sent);
  assert.equal(sent.headers.has('range'), false);
  assert.equal(sent.mode, 'no-cors');
  assert.equal(sent.credentials, 'omit');
  assert.equal(sw.entries.has(request.url), true, 'the complete media response is cached');
});

test('service worker: leaves non-media cross-origin requests untouched and preserves media cache on activation', async () => {
  const sw = serviceWorker(async () => opaqueResponse());
  const apiRequest = new TestRequest('https://api.test/data');
  const api = sw.dispatchFetch(apiRequest);
  assert.equal(api.response, undefined, 'non-media requests bypass the service worker cache');

  await sw.activate();
  assert.deepEqual(sw.deleted, ['obsolete-cache']);
});
