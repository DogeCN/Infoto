import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { LeaseClient } from '../../src/transcode/lease';
import type { SwToPageMessage } from '../../src/transcode/protocol';

test('lease client: heartbeats a held lease and stops after release or revocation', () => {
  const granted = (leaseId = 'l1'): SwToPageMessage => ({
    t: 'leaseGranted',
    leaseId,
    jobId: 'j1',
    file: new Blob(),
    mime: 'video/mp4',
    fileName: 'a.mp4',
  });
  const posted: unknown[] = [];
  const client = new LeaseClient(
    { postMessage: (m: unknown) => posted.push(m) },
    { onGranted: vi.fn(), onRevoked: vi.fn() },
  );
  client.release();
  assert.equal(posted.length, 0);
  vi.useFakeTimers();
  client.handleMessage(granted());
  vi.advanceTimersByTime(12_000);
  assert.ok(posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length >= 2);
  client.release();
  assert.ok(posted.some((m) => (m as { t: string }).t === 'leaseRelease'));
  const beatsAfter = posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length;
  vi.advanceTimersByTime(12_000);
  assert.equal(
    posted.filter((m) => (m as { t: string }).t === 'leaseHeartbeat').length,
    beatsAfter,
  );
  vi.useRealTimers();
  client.handleMessage(granted());
  client.handleMessage({ t: 'leaseRevoked', leaseId: 'l1', jobId: 'j1' });
  assert.equal(client.heldJobId, null);
});
