import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadPipeline, type PipelineTaskSnapshot } from '../../src/transcode/pipeline';

// Editor image uploads ride the same SharedWorker queue and transport as the waterfall,
// but skip its transcode leg entirely: the picked file goes up as-is. These tests pin
// that the page side surfaces that upload leg, that a failure is worded as an upload
// failure, and that a cancel settles the pending promise as an abort.

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

describe('editor upload progress', () => {
  beforeEach(() => {
    vi.stubGlobal('SharedWorker', FakeSharedWorker);
    vi.stubGlobal('window', { addEventListener: () => undefined });
    vi.stubGlobal('navigator', { deviceMemory: 8, hardwareConcurrency: 8 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces the upload leg and ignores another page', async () => {
    const { pipeline, port } = setup();
    const rows: PipelineTaskSnapshot[] = [];
    pipeline.onEditorTask((t) => rows.push(t));
    const promise = pipeline.uploadEditorImage(png());
    expect(rows[0]).toMatchObject({ phase: 'queued', fileName: 'shot.png', purpose: 'editor' });
    expect(port.sent.some((m) => m['t'] === 'addJob')).toBe(true);
    const jobId = jobIdOf(port);
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.42 });
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.8 });
    expect(rows.at(-1)?.fraction).toBe(0.8);
    status(port, {
      t: 'jobStatus',
      jobId: 'someone-elses-job',
      purpose: 'editor',
      phase: 'uploading',
      fraction: 0.5,
    });
    expect(rows.filter((r) => r.phase === 'queued')).toHaveLength(1);
    status(port, {
      t: 'jobStatus',
      jobId,
      purpose: 'editor',
      phase: 'done',
      url: 'https://host/a.webp',
    });
    await expect(promise).resolves.toBe('https://host/a.webp');
  });

  it('words failures as uploads, aborts on cancel, and retries', async () => {
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
    await expect(first).rejects.toThrow('Upload timed out');

    const cancelled = setup();
    const pending = cancelled.pipeline.uploadEditorImage(png());
    const cancelId = jobIdOf(cancelled.port);
    cancelled.pipeline.cancel(cancelId);
    expect(cancelled.port.sent.at(-1)).toMatchObject({ t: 'cancelJob', jobId: cancelId });
    status(cancelled.port, { t: 'jobRemoved', jobId: cancelId });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

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
    await expect(attempt).rejects.toThrow('Upload timed out');
    const retry = retried.pipeline.retryEditorUpload(retryId);
    expect(retried.port.sent.at(-1)).toMatchObject({ t: 'retryJob', jobId: retryId });
    status(retried.port, {
      t: 'jobStatus',
      jobId: retryId,
      purpose: 'editor',
      phase: 'done',
      url: 'https://host/b.webp',
    });
    await expect(retry).resolves.toBe('https://host/b.webp');
  });
});
