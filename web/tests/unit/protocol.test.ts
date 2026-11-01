import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  isPageToSw,
  isSwToPage,
  LEASE_HEARTBEAT_MS,
  LEASE_TIMEOUT_MS,
  editorUploadFileName,
  pipelineResultAction,
  shouldWriteAlbumUploadOp,
} from '../../src/transcode/protocol';

test('protocol: validates pipeline messages and upload purposes', () => {
  // Classifies both directions and keeps the lease timings.
  {
    assert.equal(
      isPageToSw({
        t: 'addJob',
        jobId: 'a',
        purpose: 'album',
        fileName: 'f',
        mime: 'image/png',
        file: new Blob(),
      }),
      true,
    );
    assert.equal(
      isPageToSw({
        t: 'addJob',
        jobId: 'a',
        purpose: 'editor',
        fileName: 'f',
        mime: 'image/png',
        file: new Blob(),
      }),
      true,
    );
    assert.equal(
      isPageToSw({ t: 'addJob', jobId: 'a', fileName: 'f', mime: 'image/png', file: new Blob() }),
      false,
    );
    assert.equal(isPageToSw({ t: 'opWritten', jobId: 'a' }), true);
    assert.equal(isPageToSw({ t: 'leaseVisibility', leaseId: 'l', hidden: true }), true);
    assert.equal(isPageToSw({ t: 'poolHint', deviceMemory: 8, hardwareConcurrency: 16 }), true);
    assert.equal(isPageToSw({ t: 'poolHint' }), true);
    assert.equal(isPageToSw({ t: 'jobStatus', jobId: 'a', phase: 'queued' }), false);
    assert.equal(isPageToSw(null), false);
    assert.equal(
      isSwToPage({
        t: 'jobStatus',
        jobId: 'a',
        purpose: 'album',
        phase: 'done',
        url: 'https://x',
      }),
      true,
    );
    assert.equal(
      isSwToPage({
        t: 'jobStatus',
        jobId: 'a',
        purpose: 'editor',
        phase: 'done',
        url: 'https://x',
      }),
      true,
    );
    assert.equal(
      isSwToPage({ t: 'jobStatus', jobId: 'a', phase: 'done', url: 'https://x' }),
      false,
    );
    assert.equal(
      isSwToPage({
        t: 'leaseGranted',
        leaseId: 'l',
        jobId: 'a',
        file: new Blob(),
        mime: 'video/mp4',
        fileName: 'f',
      }),
      true,
    );
    assert.equal(isSwToPage({ t: 'addJob' }), false);
    assert.equal(LEASE_HEARTBEAT_MS, 5_000);
    assert.equal(LEASE_TIMEOUT_MS, 15_000);
  }

  // Writes an album op once and only settles an editor waiter.
  {
    assert.equal(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, false), true);
    assert.equal(shouldWriteAlbumUploadOp('album', 'done', 'https://x', meta, true), false);
    assert.equal(shouldWriteAlbumUploadOp('editor', 'done', 'https://x', meta, false), false);
    assert.equal(
      pipelineResultAction(status('editor', 'done', { url: 'https://x' }), true),
      'resolve',
    );
    assert.equal(
      pipelineResultAction(status('editor', 'failed', { error: 'bad_image' }), true),
      'reject',
    );
    assert.equal(
      pipelineResultAction(status('editor', 'done', { url: 'https://x' }), false),
      'ignore',
    );
    assert.equal(
      pipelineResultAction(status('album', 'done', { url: 'https://x' }), true),
      'observe',
    );
    assert.equal(pipelineResultAction(status('editor', 'done'), true), 'reject');
  }
});

const meta = { width: 1, height: 1, size: 1, type: 0 as const };

function status(
  purpose: 'album' | 'editor',
  phase: 'queued' | 'done' | 'failed',
  extra: { url?: string; error?: string } = {},
) {
  return { t: 'jobStatus' as const, jobId: 'job', purpose, phase, ...extra };
}

test('editor upload: the picked name survives, so a document is never relabelled .bin', () => {
  // The reported bug: the admin announcement editor accepts any file, and a non-media
  // pick came back as `<id>.bin`. The extension is load-bearing — the Markdown renderer
  // decides how to display a hosted file by extension — and MIME cannot recover it,
  // because File.type is '' for most non-media extensions. The picked name must win.
  for (const name of ['notes.md', 'readme.txt', 'bundle.zip', 'slides.pdf', 'data.csv']) {
    assert.equal(editorUploadFileName(name), name);
  }
  // A real extension is kept whatever it is; only a name without one defers to MIME.
  assert.equal(editorUploadFileName('report.final'), 'report.final');
  assert.equal(editorUploadFileName('noext'), undefined);
  assert.equal(editorUploadFileName(''), undefined, 'an empty pick has nothing to keep');
  assert.equal(editorUploadFileName(undefined), undefined);
  // Only the LAST dot-segment counts, and it must be a plain alphanumeric extension.
  assert.equal(editorUploadFileName('archive.tar.gz'), 'archive.tar.gz');
  assert.equal(editorUploadFileName('name.'), undefined, 'a trailing dot is not an extension');
  assert.equal(
    editorUploadFileName('weird.ext!'),
    undefined,
    'a non-alphanumeric suffix defers to MIME',
  );
});
