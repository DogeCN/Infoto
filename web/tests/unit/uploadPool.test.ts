// The upload leg has its own concurrency ceiling (uploadPoolSize), separate from the image
// pool that bounds transcoding. Before it existed, one multi-file drop opened as many
// concurrent POSTs as the CPU pool allowed against a single upstream.
import 'fake-indexeddb/auto';
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

const h = vi.hoisted(() => ({ postUpload: vi.fn() }));

vi.mock('../../src/core/api/uploadClient', () => ({ postUpload: h.postUpload }));
vi.mock('../../src/transcode/image.worker', () => ({ transcodeImage: vi.fn() }));
vi.mock('../../src/transcode/opfs', () => ({
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
  removeArtifact: vi.fn(),
}));

interface FakePort {
  sent: Array<Record<string, unknown>>;
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage(m: unknown): void;
  start(): void;
}

function fakePort(): FakePort {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    onmessage: null,
    postMessage: (m) => sent.push(m as Record<string, unknown>),
    start: () => undefined,
  };
}

async function until(pred: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 3_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('upload pool: the upload leg runs at its own ceiling, not the transcode pool', async () => {
  // Only the sweep intervals are faked; the harness needs real timers to await on.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let inFlight = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  h.postUpload.mockImplementation(() => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => {
      releases.push(() => {
        inFlight--;
        resolve({ ok: true, url: 'https://cdn.test/m.webp' });
      });
    });
  });
  // The completion path prewarms the returned URL; an immediate rejection keeps the test off
  // the network without changing what is asserted here.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  vi.stubGlobal('self', {});
  vi.stubGlobal('onconnect', undefined);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 });
  await import('../../src/transcode/sw');

  const port = fakePort();
  assert.equal(typeof onconnect, 'function');
  onconnect!({ ports: [port] } as unknown as MessageEvent);

  // Editor uploads take no transcode leg, so they isolate the upload gate from the image pool.
  const addEditor = (jobId: string): void => {
    port.onmessage!({
      data: {
        t: 'addJob',
        jobId,
        purpose: 'editor',
        fileName: `${jobId}.webp`,
        mime: 'image/webp',
        file: new Blob(['x'], { type: 'image/webp' }),
      },
    });
  };
  for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) addEditor(id);

  await until(() => h.postUpload.mock.calls.length >= 3, 'the first three uploads to start');
  await new Promise((r) => setTimeout(r, 20));
  // The image pool on this machine is 6; the upload leg must still hold at three.
  assert.equal(h.postUpload.mock.calls.length, 3);
  assert.equal(peak, 3);

  // Finishing one hands its slot to the next waiter, never opening a fourth.
  releases.shift()!();
  await until(() => h.postUpload.mock.calls.length === 4, 'the fourth upload to start');
  assert.equal(peak, 3);

  // Drain the rest: every hand-off keeps the ceiling.
  await until(() => {
    if (releases.length > 0) releases.shift()!();
    return h.postUpload.mock.calls.length === 5 && releases.length === 0;
  }, 'every upload to start and drain');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(peak, 3);
  assert.equal(inFlight, 0);
});
