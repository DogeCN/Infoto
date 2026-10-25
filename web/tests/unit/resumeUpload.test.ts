// An upload-leg failure rewrites its photo record as `failed`: the artifact is still in OPFS, so
// the card comes back after a reload with its image and a retry the user presses. The status is
// what keeps the reload from re-running /upload on its own — a resume is for a transfer
// interrupted mid-flight, not for one the facade rejected.
import 'fake-indexeddb/auto';
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { openOplogDb, readPhotoRecord } from '../../src/core/oplog';

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

test('album upload resume: an upload failure keeps a marked record so the card survives a reload', async () => {
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
  // The facade address arrives before any job; without it a job fails rather than guessing
  // a host (see `runUpload`'s media_host_unset guard).
  port.onmessage!({ data: { t: 'mediaHost', url: 'https://facade.test' } });
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

  // afterStage1 persists the record as `uploading` before runUpload starts the transfer.
  await until(
    async () => (await readPhotoRecord(db, 'sha-failed'))?.status === 'uploading',
    'the uploading record to persist',
  );
  assert.equal(h.postUpload.mock.calls.length, 1);

  releaseUpload!({ ok: false, error: 'timeout' });

  // The record stays, marked, so `resumePendingUploads` rebuilds a failed card instead of
  // re-running the upload the facade just rejected.
  await until(
    async () => (await readPhotoRecord(db, 'sha-failed'))?.status === 'failed',
    'the record to be marked failed',
  );
  const record = await readPhotoRecord(db, 'sha-failed');
  // The artifact handle survives on the record; the job id lives only there, as a handle.
  assert.equal(record?.artifact?.key, 'job-fail');
  assert.equal(record?.status, 'failed');
  // The reason travels with the record, so the reloaded card reports it instead of a generic one.
  assert.equal(record?.error, 'timeout');
  assert.equal(
    port.sent.some((m) => m['t'] === 'jobStatus' && m['phase'] === 'failed'),
    true,
  );
  db.close();
});
