// A terminal album-upload failure must drop its resume record, so a later page load
// cannot rebuild the job and re-run /upload (retryJob stays the only retry path).
import 'fake-indexeddb/auto';
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { openOplogDb, readPendingUploads } from '../../src/core/oplog';

const h = vi.hoisted(() => ({
  postUpload: vi.fn(),
  transcodeImage: vi.fn(),
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
}));

vi.mock('../../src/core/api/uploadClient', () => ({ postUpload: h.postUpload }));
vi.mock('../../src/transcode/image.worker', () => ({ transcodeImage: h.transcodeImage }));
vi.mock('../../src/transcode/opfs', () => ({
  storeArtifact: h.storeArtifact,
  readArtifact: h.readArtifact,
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

async function freshDb(): Promise<IDBDatabase> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('infoto');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  return openOplogDb();
}

async function until(pred: () => Promise<boolean>, label: string): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > 3_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('album upload resume: a failed attempt drops its pending record so a later load cannot re-run it', async () => {
  // Only the sweep intervals are faked; fake-indexeddb keeps scheduling real tasks.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  h.transcodeImage.mockResolvedValue({
    ok: true,
    blob: new Blob(['webp'], { type: 'image/webp' }),
    width: 2,
    height: 2,
  });
  h.storeArtifact.mockResolvedValue({ sha256: 'sha-failed', bytes: 12 });
  h.readArtifact.mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }));
  // Hold the /upload attempt open so the persisted record is observable before the failure lands.
  let releaseUpload: ((r: { ok: false; error: string }) => void) | undefined;
  h.postUpload.mockImplementation(
    () =>
      new Promise<{ ok: false; error: string }>((resolve) => {
        releaseUpload = resolve;
      }),
  );

  const db = await freshDb();
  vi.stubGlobal('self', {});
  vi.stubGlobal('onconnect', undefined);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 });
  await import('../../src/transcode/sw');

  const port = fakePort();
  assert.equal(typeof onconnect, 'function');
  onconnect!({ ports: [port] } as unknown as MessageEvent);
  port.onmessage!({
    data: {
      t: 'addJob',
      jobId: 'job-fail',
      purpose: 'album',
      fileName: 'photo.png',
      mime: 'image/png',
      file: new Blob(['x'], { type: 'image/png' }),
    },
  });

  // afterStage1 persists the resume record before runUpload starts the transfer.
  await until(
    async () => (await readPendingUploads(db)).length === 1,
    'the pending record to persist',
  );
  assert.equal(h.postUpload.mock.calls.length, 1);

  releaseUpload!({ ok: false, error: 'timeout' });

  // The terminal failure must delete it; otherwise resumePendingUploads rebuilds the job.
  await until(async () => (await readPendingUploads(db)).length === 0, 'the record to be dropped');
  assert.equal(
    port.sent.some((m) => m['t'] === 'jobStatus' && m['phase'] === 'failed'),
    true,
  );
  db.close();
});
