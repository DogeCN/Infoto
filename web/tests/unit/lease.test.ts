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

test('lease client: reports document visibility for the held lease', () => {
  const posted: Array<Record<string, unknown>> = [];
  const scopeHandlers = new Map<string, () => void>();
  const docHandlers = new Map<string, () => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, handler: unknown) => {
      docHandlers.set(type, handler as () => void);
    },
  };
  // `visibilitychange` is fired at the document, so the listener must live there: one on the
  // window would depend on bubbling the spec does not promise.
  vi.stubGlobal('document', doc);

  const client = new LeaseClient(
    { postMessage: (m: unknown) => posted.push(m as Record<string, unknown>) },
    { onGranted: vi.fn(), onRevoked: vi.fn() },
  );
  client.install({
    addEventListener: (type: string, handler: unknown) => {
      scopeHandlers.set(type, handler as () => void);
    },
  } as unknown as Window);

  assert.equal(scopeHandlers.has('pagehide'), true);
  assert.equal(scopeHandlers.has('visibilitychange'), false);
  assert.equal(docHandlers.has('visibilitychange'), true);

  client.handleMessage({
    t: 'leaseGranted',
    leaseId: 'l1',
    jobId: 'j1',
    file: new Blob(),
    mime: 'video/mp4',
    fileName: 'a.mp4',
  });
  // A lease granted while the document is already hidden must say so up front, otherwise the
  // reaper starts it as visible and kills it on the first throttled heartbeat.
  assert.deepEqual(posted.at(-1), { t: 'leaseVisibility', leaseId: 'l1', hidden: false });

  doc.visibilityState = 'hidden';
  docHandlers.get('visibilitychange')!();
  assert.deepEqual(posted.at(-1), { t: 'leaseVisibility', leaseId: 'l1', hidden: true });

  // Hiding the document never releases the token: the video worker is still encoding.
  assert.equal(
    posted.some((m) => m['t'] === 'leaseRelease'),
    false,
  );
  client.release();
  vi.unstubAllGlobals();
});

test('lease client: heartbeats every held lease, not only the newest', () => {
  // The video pool grants two or more leases to the same page. A single-slot client stopped the
  // older lease's heartbeat on the newer grant, so the SW read that silence as a dead page,
  // revoked the lease after LEASE_TIMEOUT_MS, and re-encoded the job from zero.
  const granted = (leaseId: string, jobId: string): SwToPageMessage => ({
    t: 'leaseGranted',
    leaseId,
    jobId,
    file: new Blob(),
    mime: 'video/mp4',
    fileName: 'a.mp4',
  });
  const posted: Array<Record<string, unknown>> = [];
  const client = new LeaseClient(
    { postMessage: (m: unknown) => posted.push(m as Record<string, unknown>) },
    { onGranted: vi.fn(), onRevoked: vi.fn() },
  );
  const beats = (): string[] => [
    ...new Set(
      posted.filter((m) => m['t'] === 'leaseHeartbeat').map((m) => m['leaseId'] as string),
    ),
  ];

  vi.useFakeTimers();
  client.handleMessage(granted('l1', 'j1'));
  client.handleMessage(granted('l2', 'j2'));
  vi.advanceTimersByTime(11_000);
  assert.deepEqual(beats().sort(), ['l1', 'l2']);

  // Revoking one lease must leave the other beating.
  client.handleMessage({ t: 'leaseRevoked', leaseId: 'l1', jobId: 'j1' });
  posted.length = 0;
  vi.advanceTimersByTime(11_000);
  assert.deepEqual(beats(), ['l2']);

  // One job finishing returns only its own token.
  posted.length = 0;
  client.release('j2');
  assert.deepEqual(posted, [{ t: 'leaseRelease', leaseId: 'l2' }]);
  vi.useRealTimers();
});
