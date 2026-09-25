import { describe, expect, it } from 'vitest';
import {
  isPageToSw,
  isSwToPage,
  LEASE_HEARTBEAT_MS,
  LEASE_TIMEOUT_MS,
} from '../../src/transcode/shared/protocol';

describe('protocol', () => {
  it('classifies page→sw messages', () => {
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
    expect(isPageToSw({ t: 'poolHint' })).toBe(true); // both readings optional (Firefox)
    expect(isPageToSw({ t: 'jobStatus', jobId: 'a', phase: 'queued' })).toBe(false);
    expect(isPageToSw(null)).toBe(false);
  });

  it('classifies sw→page messages', () => {
    expect(
      isSwToPage({ t: 'jobStatus', jobId: 'a', purpose: 'album', phase: 'done', url: 'https://x' }),
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
    expect(isSwToPage({ t: 'jobStatus', jobId: 'a', phase: 'done', url: 'https://x' })).toBe(false);
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
  });

  it('lease constants match the contract', () => {
    expect(LEASE_HEARTBEAT_MS).toBe(5_000);
    expect(LEASE_TIMEOUT_MS).toBe(15_000);
  });
});
