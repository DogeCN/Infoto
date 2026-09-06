import { describe, expect, it } from 'vitest';
import { isPageToSw, isSwToPage, LEASE_HEARTBEAT_MS, LEASE_TIMEOUT_MS, VIDEO_LEASE_LIMIT } from '../../src/transcode/shared/protocol';

describe('protocol', () => {
	it('classifies page→sw messages', () => {
		expect(isPageToSw({ t: 'addJob', jobId: 'a', fileName: 'f', mime: 'image/png', file: new Blob() })).toBe(true);
		expect(isPageToSw({ t: 'opWritten', jobId: 'a' })).toBe(true);
		expect(isPageToSw({ t: 'jobStatus', jobId: 'a', phase: 'queued' })).toBe(false);
		expect(isPageToSw(null)).toBe(false);
	});

	it('classifies sw→page messages', () => {
		expect(isSwToPage({ t: 'jobStatus', jobId: 'a', phase: 'done', url: 'https://x' })).toBe(true);
		expect(isSwToPage({ t: 'leaseGranted', leaseId: 'l', jobId: 'a', file: new Blob(), mime: 'video/mp4', fileName: 'f' })).toBe(true);
		expect(isSwToPage({ t: 'addJob' })).toBe(false);
	});

	it('lease constants match the contract', () => {
		expect(LEASE_HEARTBEAT_MS).toBe(5_000);
		expect(LEASE_TIMEOUT_MS).toBe(15_000);
		expect(VIDEO_LEASE_LIMIT).toBe(1);
	});
});
