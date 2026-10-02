import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { UploadPipeline, type PipelineTaskSnapshot } from '../../src/transcode/pipeline';

// Verify direct editor upload progress, failure classification, and cancellation.

class FakePort {
  sent: Array<Record<string, unknown>> = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown): void {
    this.sent.push(m as Record<string, unknown>);
  }
  start(): void {}
}

const ports: FakePort[] = [];

class FakeSharedWorker {
  port = new FakePort();
  constructor(_url?: URL, _opts?: unknown) {
    ports.push(this.port);
  }
}

function setup(): { pipeline: UploadPipeline; port: FakePort } {
  ports.length = 0;
  const pipeline = new UploadPipeline({ swUrl: new URL('http://localhost/sw.js') });
  pipeline.start();
  return { pipeline, port: ports[0]! };
}

function status(port: FakePort, msg: Record<string, unknown>): void {
  port.onmessage?.({ data: msg } as MessageEvent);
}

function jobIdOf(port: FakePort): string {
  const m = port.sent.find((x) => x['t'] === 'addJob');
  return String(m?.['jobId']);
}

function png(): File {
  return new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
}

beforeEach(() => {
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  vi.stubGlobal('window', { addEventListener: () => undefined });
  vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 8 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('editor upload progress: surfaces the upload leg and ignores another page', async () => {
  const { pipeline, port } = setup();
  const rows: PipelineTaskSnapshot[] = [];
  pipeline.onEditorTask((t) => rows.push(t));
  const promise = pipeline.uploadEditorImage(png());
  assert.equal(rows[0].phase, 'queued');
  assert.equal(rows[0].fileName, 'shot.png');
  assert.equal(rows[0].purpose, 'editor');
  assert.equal(
    port.sent.some((m) => m['t'] === 'addJob'),
    true,
  );
  const jobId = jobIdOf(port);
  status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.42 });
  status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.8 });
  assert.equal(rows.at(-1)?.fraction, 0.8);
  status(port, {
    t: 'jobStatus',
    jobId: 'someone-elses-job',
    purpose: 'editor',
    phase: 'uploading',
    fraction: 0.5,
  });
  assert.equal(rows.filter((r) => r.phase === 'queued').length, 1);
  status(port, {
    t: 'jobStatus',
    jobId,
    purpose: 'editor',
    phase: 'done',
    url: 'https://host/a.webp',
  });
  assert.equal(await promise, 'https://host/a.webp');
});

test('editor upload progress: words failures as uploads, aborts on cancel, and retries', async () => {
  const failed = setup();
  const first = failed.pipeline.uploadEditorImage(png());
  const failedId = jobIdOf(failed.port);
  status(failed.port, {
    t: 'jobStatus',
    jobId: failedId,
    purpose: 'editor',
    phase: 'failed',
    error: 'timeout',
  });
  await assert.rejects(first, /Upload timed out/);

  const cancelled = setup();
  const pending = cancelled.pipeline.uploadEditorImage(png());
  const cancelId = jobIdOf(cancelled.port);
  cancelled.pipeline.cancel(cancelId);
  const cancelRequest = cancelled.port.sent.at(-1);
  assert.equal(cancelRequest?.['t'], 'cancelJob');
  assert.equal(cancelRequest?.['jobId'], cancelId);
  status(cancelled.port, { t: 'jobRemoved', jobId: cancelId });
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as Error).name, 'AbortError');
    return true;
  });

  const retried = setup();
  const attempt = retried.pipeline.uploadEditorImage(png());
  const retryId = jobIdOf(retried.port);
  status(retried.port, {
    t: 'jobStatus',
    jobId: retryId,
    purpose: 'editor',
    phase: 'failed',
    error: 'timeout',
  });
  await assert.rejects(attempt, /Upload timed out/);
  const retry = retried.pipeline.retryEditorUpload(retryId);
  const retryRequest = retried.port.sent.at(-1);
  assert.equal(retryRequest?.['t'], 'retryJob');
  assert.equal(retryRequest?.['jobId'], retryId);
  status(retried.port, {
    t: 'jobStatus',
    jobId: retryId,
    purpose: 'editor',
    phase: 'done',
    url: 'https://host/b.webp',
  });
  assert.equal(await retry, 'https://host/b.webp');
});
