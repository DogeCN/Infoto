import { describe, expect, it } from 'vitest';
import {
  isPageToSw,
  isSwToPage,
  LEASE_HEARTBEAT_MS,
  LEASE_TIMEOUT_MS,
  pipelineResultAction,
  shouldWriteAlbumUploadOp,
} from '../../src/transcode/protocol';

describe('protocol', () => {
  it('validates pipeline messages and upload purposes', async () => {
    // Classifies both directions and keeps the lease timings.
    {
      expect(
        isPageToSw({
          t: 'addJob',
          jobId: 'a',
          purpose: 'album',
          fileName: 'f',
          mime: 'image/png',
          file: new Blob(),
        }),
      ).toBe(true);
      expect(
        isPageToSw({
          t: 'addJob',
          jobId: 'a',
          purpose: 'editor',
          fileName: 'f',
          mime: 'image/png',
          file: new Blob(),
        }),
      ).toBe(true);
      expect(
        isPageToSw({ t: 'addJob', jobId: 'a', fileName: 'f', mime: 'image/png', file: new Blob() }),
      ).toBe(false);
      expect(isPageToSw({ t: 'opWritten', jobId: 'a' })).toBe(true);
      expect(isPageToSw({ t: 'poolHint', deviceMemory: 8, hardwareConcurrency: 16 })).toBe(true);
      expect(isPageToSw({ t: 'poolHint' })).toBe(true);
      expect(isPageToSw({ t: 'jobStatus', jobId: 'a', phase: 'queued' })).toBe(false);
      expect(isPageToSw(null)).toBe(false);
      expect(
        isSwToPage({
          t: 'jobStatus',
          jobId: 'a',
          purpose: 'album',
          phase: 'done',
          url: 'https://x',
        }),
      ).toBe(true);
      expect(
        isSwToPage({
          t: 'jobStatus',
          jobId: 'a',
          purpose: 'editor',
          phase: 'done',
          url: 'https://x',
        }),
      ).toBe(true);
      expect(isSwToPage({ t: 'jobStatus', jobId: 'a', phase: 'done', url: 'https://x' })).toBe(
        false,
      );
      expect(
        isSwToPage({
          t: 'leaseGranted',
          leaseId: 'l',
          jobId: 'a',
          file: new Blob(),
          mime: 'video/mp4',
          fileName: 'f',
        }),
      ).toBe(true);
      expect(isSwToPage({ t: 'addJob' })).toBe(false);
      expect(LEASE_HEARTBEAT_MS).toBe(5_000);
      expect(LEASE_TIMEOUT_MS).toBe(15_000);
    }

    // Writes an album op once and only settles an editor waiter.
    {
      expect(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, false)).toBe(true);
      expect(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, true)).toBe(false);
      expect(shouldWriteAlbumUploadOp('editor', 'done', 'https://x', meta, false)).toBe(false);
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
      expect(pipelineResultAction(status('editor', 'done'), true)).toBe('reject');
    }
  });
});

const meta = { width: 1, height: 1, size: 1, type: 0 as const };

function status(
  purpose: 'album' | 'editor',
  phase: 'queued' | 'done' | 'failed',
  extra: { url?: string; error?: string } = {},
) {
  return { t: 'jobStatus' as const, jobId: 'job', purpose, phase, ...extra };
}
