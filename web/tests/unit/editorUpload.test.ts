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

  it('shows a row as soon as the file is handed to the pipeline', () => {
    const { pipeline, port } = setup();
    const rows: PipelineTaskSnapshot[] = [];
    pipeline.onEditorTask((t) => rows.push(t));
    void pipeline.uploadEditorImage(png());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: 'queued', fileName: 'shot.png', purpose: 'editor' });
    expect(port.sent.some((m) => m['t'] === 'addJob')).toBe(true);
  });

  it('forwards the upload leg with fractions', () => {
    const { pipeline, port } = setup();
    const rows: PipelineTaskSnapshot[] = [];
    pipeline.onEditorTask((t) => rows.push(t));
    void pipeline.uploadEditorImage(png());
    const jobId = jobIdOf(port);

    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.42 });
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.8 });

    expect(rows.map((r) => r.phase)).toEqual(['queued', 'uploading', 'uploading']);
    expect(rows.at(-1)?.fraction).toBe(0.8);
  });

  it('resolves with the hosted URL and clears the row on done', async () => {
    const { pipeline, port } = setup();
    const rows: PipelineTaskSnapshot[] = [];
    pipeline.onEditorTask((t) => rows.push(t));
    const promise = pipeline.uploadEditorImage(png());
    const jobId = jobIdOf(port);

    status(port, {
      t: 'jobStatus',
      jobId,
      purpose: 'editor',
      phase: 'done',
      url: 'https://host/a.webp',
    });

    await expect(promise).resolves.toBe('https://host/a.webp');
    expect(rows.at(-1)?.phase).toBe('done');
  });

  it('words every editor failure as an upload error', async () => {
    const { pipeline, port } = setup();
    const promise = pipeline.uploadEditorImage(png());
    const jobId = jobIdOf(port);

    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.1 });
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'failed', error: 'timeout' });

    await expect(promise).rejects.toThrow('Upload timed out');
  });

  it('settles a pending upload as an abort when its job is removed', async () => {
    const { pipeline, port } = setup();
    const promise = pipeline.uploadEditorImage(png());
    const jobId = jobIdOf(port);

    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.3 });
    pipeline.cancel(jobId);
    expect(port.sent.at(-1)).toMatchObject({ t: 'cancelJob', jobId });

    status(port, { t: 'jobRemoved', jobId });

    // AbortError, not a failure: the owner stays quiet instead of showing an error.
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('ignores editor progress for jobs enqueued by another page', () => {
    const { pipeline, port } = setup();
    const rows: PipelineTaskSnapshot[] = [];
    pipeline.onEditorTask((t) => rows.push(t));
    void pipeline.uploadEditorImage(png());

    status(port, {
      t: 'jobStatus',
      jobId: 'someone-elses-job',
      purpose: 'editor',
      phase: 'uploading',
      fraction: 0.5,
    });

    expect(rows).toHaveLength(1); // only the local 'queued' row
  });

  it('retryEditorUpload re-registers a waiter and delivers the URL on retry success', async () => {
    const { pipeline, port } = setup();
    const first = pipeline.uploadEditorImage(png());
    const jobId = jobIdOf(port);

    // First attempt fails on the upload leg → waiter consumed.
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'uploading', fraction: 0.1 });
    status(port, { t: 'jobStatus', jobId, purpose: 'editor', phase: 'failed', error: 'timeout' });
    await expect(first).rejects.toThrow('Upload timed out');
    expect(port.sent.some((m) => m['t'] === 'editorResultAck')).toBe(true);

    // Retry: a fresh waiter is registered and retryJob is sent.
    const retry = pipeline.retryEditorUpload(jobId);
    expect(port.sent.at(-1)).toMatchObject({ t: 'retryJob', jobId });

    status(port, {
      t: 'jobStatus',
      jobId,
      purpose: 'editor',
      phase: 'done',
      url: 'https://host/b.webp',
    });

    await expect(retry).resolves.toBe('https://host/b.webp');
  });
});
