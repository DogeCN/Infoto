import { describe, expect, it } from 'vitest';
import { pipelineResultAction, shouldWriteAlbumUploadOp } from '../../src/transcode/uploadPurpose';

const meta = { width: 1, height: 1, size: 1, type: 0 as const };

function status(
  purpose: 'album' | 'editor',
  phase: 'queued' | 'done' | 'failed',
  extra: { url?: string; error?: string } = {},
) {
  return { t: 'jobStatus' as const, jobId: 'job', purpose, phase, ...extra };
}

describe('upload purpose routing', () => {
  it('writes upload ops only once for completed album jobs', () => {
    expect(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, false)).toBe(true);
    expect(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, true)).toBe(false);
    expect(shouldWriteAlbumUploadOp('editor', 'done', 'https://x', meta, false)).toBe(false);
  });

  it('resolves and rejects only an editor terminal with an owning waiter', () => {
    expect(pipelineResultAction(status('editor', 'done', { url: 'https://x' }), true)).toBe(
      'resolve',
    );
    expect(pipelineResultAction(status('editor', 'failed', { error: 'bad_image' }), true)).toBe(
      'reject',
    );
    expect(pipelineResultAction(status('editor', 'done', { url: 'https://x' }), false)).toBe(
      'ignore',
    );
    expect(pipelineResultAction(status('album', 'done', { url: 'https://x' }), true)).toBe(
      'observe',
    );
  });

  it('does not resolve an editor done result without a URL', () => {
    expect(pipelineResultAction(status('editor', 'done'), true)).toBe('reject');
  });
});
