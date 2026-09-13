// SharedWorker entry — transcode queue / image pool / video token pool /
// heartbeat leases.
// (Contract: the SharedWorker global has neither WebCodecs nor the Worker
// constructor — image transcoding runs on this thread by importing
// image.worker.ts as a module; video is only dispatched here, actual
// transcoding happens in the page's top-level DedicatedWorker.)

import type { MediaType } from '$shared/types';
import { artifactExt, imagePoolSize, isOversize, routeByMime, videoPoolSize } from '$base/upload/pipeline';
import { postUpload } from '../core/api/uploadClient';
import { lookupSha } from '../core/oplog/cache';
import { openOplogDb } from '../core/oplog/store';
import { readArtifact, storeArtifact } from './opfs';
import { transcodeImage } from './image.worker';
import {
	LEASE_TIMEOUT_MS,
	isPageToSw,
	type JobMeta,
	type JobPhase,
	type PageToSwMessage,
	type SwToPageMessage,
} from './shared/protocol';

// ---- environment & channels ----------------------------------------------------

const ports = new Set<MessagePort>();
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('infoto-upload') : null;

function broadcast(m: SwToPageMessage): void {
	for (const p of ports) p.postMessage(m);
	bc?.postMessage(m);
}

// ---- job state -----------------------------------------------------------------

interface JobRec {
	jobId: string;
	fileName: string;
	mime: string;
	file: Blob;
	engine: 'image' | 'video' | 'gif';
	phase: JobPhase;
	/** Stage-1 artifact metadata (needed by stage 2). */
	artifact?: { ext: 'webp' | 'webm'; size: number };
	sha256?: string;
	meta?: JobMeta;
	url?: string;
	error?: string;
	/** The upload op has been written to the op-log by some page. */
	opWritten: boolean;
	/** Cancellation flag for image jobs. */
	cancelled: boolean;
	/** Token lease info (video/gif). */
	leaseId?: string;
}

const jobs = new Map<string, JobRec>();
const imageQueue: string[] = [];
const videoQueue: string[] = []; // jobIds waiting for a token
let imageRunning = 0;
let db: IDBDatabase | null = null;

// ---- lease pool ----------------------------------------------------------------

interface Lease {
	leaseId: string;
	jobId: string;
	port: MessagePort;
	lastBeat: number;
}
const leases = new Map<string, Lease>();

/**
 * Global video concurrency (1–2, contract "架构"). Computed from the SW's own
 * navigator at startup; refined by each page's poolHint (deviceMemory is
 * window-only). Pages on one machine report identical readings, so a
 * last-write-wins update is exact in practice.
 */
let videoLimit = videoPoolSize('navigator' in self ? navigator : {});

function uid(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function notify(rec: JobRec, extra: Partial<Extract<SwToPageMessage, { t: 'jobStatus' }>> = {}): void {
	broadcast({
		t: 'jobStatus',
		jobId: rec.jobId,
		phase: rec.phase,
		url: rec.url,
		error: rec.error,
		meta: rec.meta,
		sha256: rec.sha256,
		...extra,
	});
}

// ---- scheduling ----------------------------------------------------------------

function pumpImage(): void {
	const pool = imagePoolSize(
		'navigator' in self ? navigator.hardwareConcurrency : undefined,
		'navigator' in self ? (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink : undefined,
	);
	while (imageRunning < pool && imageQueue.length > 0) {
		const id = imageQueue.shift()!;
		const rec = jobs.get(id);
		if (!rec || rec.cancelled || rec.phase !== 'queued') continue;
		imageRunning++;
		void runImageJob(rec).finally(() => {
			imageRunning--;
			pumpImage();
		});
	}
}

function pumpVideoLeases(): void {
	while (leases.size < videoLimit && videoQueue.length > 0) {
		const jobId = videoQueue.shift()!;
		const rec = jobs.get(jobId);
		if (!rec || rec.cancelled || rec.phase !== 'lease-wait') continue;
		const port = ownerPort(rec);
		if (!port) {
			// the owning page is gone: mark failed (the source Blob dies with it, no reassignment)
			rec.phase = 'failed';
			rec.error = 'source_unavailable';
			notify(rec);
			continue;
		}
		const leaseId = uid();
		rec.phase = 'transcoding';
		rec.leaseId = leaseId;
		leases.set(leaseId, { leaseId, jobId, port, lastBeat: Date.now() });
		port.postMessage({ t: 'leaseGranted', leaseId, jobId, file: rec.file, mime: rec.mime, fileName: rec.fileName });
		notify(rec, { fraction: 0 });
	}
}

/** Video jobs always transcode on the page that added them (the source Blob lives on a clone reference there). */
function ownerPort(rec: JobRec): MessagePort | null {
	const pid = owners.get(rec.jobId);
	if (pid === undefined) return null;
	const entry = portById.get(pid);
	return entry && ports.has(entry) ? entry : null;
}

const owners = new Map<string, number>();
const portIds = new Map<MessagePort, number>();
let nextPortId = 1;
const portById = new Map<number, MessagePort>();

// ---- stage 1: images (on the SharedWorker thread) ---------------------------------

async function runImageJob(rec: JobRec): Promise<void> {
	rec.phase = 'transcoding';
	notify(rec, { fraction: 0 });
	try {
		const r = await transcodeImage(rec.file);
		if (rec.cancelled) return;
		if (!r.ok) {
			rec.phase = 'failed';
			rec.error = r.error;
			notify(rec);
			return;
		}
		rec.phase = 'hashing';
		notify(rec);
		const { sha256, bytes } = await storeArtifact(rec.jobId, r.blob, 'webp');
		if (rec.cancelled) return;
		rec.sha256 = sha256;
		rec.meta = { width: r.width, height: r.height, size: bytes, type: 0 };
		rec.artifact = { ext: 'webp', size: bytes };
		await afterStage1(rec);
	} catch (e) {
		rec.phase = 'failed';
		rec.error = String((e as Error)?.message ?? e);
		notify(rec);
	}
}

// ---- stage 1 done: dedupe → stage 2 ------------------------------------------------

async function afterStage1(rec: JobRec): Promise<void> {
	// sha256 dedupe: a cache hit skips stage 2 and notifies "duplicate" (spec)
	if (!db) db = await openOplogDb().catch(() => null as unknown as IDBDatabase);
	if (db && rec.sha256) {
		const hit = await lookupSha(db, rec.sha256).catch(() => undefined);
		if (hit) {
			rec.phase = 'duplicate';
			notify(rec);
			return;
		}
	}
	rec.phase = 'uploading';
	notify(rec, { fraction: 0 });
	await runUpload(rec);
}

/** Stage 2: 100MB pre-check + one /upload attempt (contract: no auto-retry — a
 *  failure marks the file, the artifact stays in OPFS, retryJob is manual-only). */
async function runUpload(rec: JobRec): Promise<void> {
	const ext = artifactExt(rec.meta!.type === 0 ? 'image' : 'webm');
	const blob = await readArtifact(rec.jobId, ext);
	if (!blob) {
		rec.phase = 'failed';
		rec.error = 'source_unavailable';
		notify(rec);
		return;
	}
	// >100MB fails immediately, artifact stays in OPFS (spec size limit)
	if (isOversize(blob.size)) {
		rec.phase = 'failed';
		rec.error = 'oversize';
		notify(rec);
		return;
	}
	const r = await postUpload(blob, { origin: self.location.origin });
	if (r.ok) {
		rec.url = r.url;
		rec.phase = 'done';
		notify(rec);
		return;
	}
	rec.phase = 'failed';
	rec.error = r.error;
	notify(rec);
}

// ---- video: page callbacks ---------------------------------------------------------

function onVideoResult(rec: JobRec, blob: Blob, width: number, height: number, hasAudio: boolean): void {
	if (rec.leaseId) leases.delete(rec.leaseId);
	void (async () => {
		try {
			const type: MediaType = hasAudio ? 2 : 1;
			rec.phase = 'hashing';
			notify(rec);
			const { sha256, bytes } = await storeArtifact(rec.jobId, blob, 'webm');
			rec.sha256 = sha256;
			rec.meta = { width, height, size: bytes, type };
			rec.artifact = { ext: 'webm', size: bytes };
			await afterStage1(rec);
		} catch (e) {
			rec.phase = 'failed';
			rec.error = String((e as Error)?.message ?? e);
			notify(rec);
		} finally {
			pumpVideoLeases();
		}
	})();
}

function onVideoFailed(rec: JobRec, error: string): void {
	if (rec.leaseId) leases.delete(rec.leaseId);
	rec.phase = 'failed';
	rec.error = error;
	notify(rec);
	pumpVideoLeases();
}

/** Manual retry handle: re-enqueue a failed job; skip transcode when the artifact is already in OPFS. */
function onRetry(jobId: string): void {
	const rec = jobs.get(jobId);
	if (!rec || (rec.phase !== 'failed' && rec.phase !== 'done')) return;
	rec.error = undefined;
	rec.url = undefined;
	rec.opWritten = false;
	rec.cancelled = false;
	if (rec.artifact && rec.sha256) {
		// artifact already on disk: go straight to dedupe/upload
		rec.phase = 'uploading';
		notify(rec, { fraction: 0 });
		void runUpload(rec);
		return;
	}
	rec.phase = 'queued';
	notify(rec);
	if (rec.engine === 'image') imageQueue.push(jobId);
	else {
		rec.phase = 'lease-wait';
		videoQueue.push(jobId);
		pumpVideoLeases();
	}
	pumpImage();
}

// ---- lease reaper (force-revoke after 15s without a heartbeat) -----------------------

setInterval(() => {
	const now = Date.now();
	for (const [leaseId, lease] of leases) {
		if (now - lease.lastBeat > LEASE_TIMEOUT_MS) {
			leases.delete(leaseId);
			const rec = jobs.get(lease.jobId);
			if (rec && rec.leaseId === leaseId) {
				rec.leaseId = undefined;
				rec.phase = 'lease-wait';
				// in-flight job re-enqueues (transcoding is idempotent; OPFS artifact sha256 dedupe backstops)
				videoQueue.push(rec.jobId);
				lease.port.postMessage({ t: 'leaseRevoked', leaseId, jobId: lease.jobId });
				notify(rec);
				pumpVideoLeases();
			}
		}
	}
}, 2_000);

// ---- connection & message dispatch ---------------------------------------------------

onconnect = (e: MessageEvent) => {
	const port = e.ports[0]!;
	ports.add(port);
	const pid = nextPortId++;
	portIds.set(port, pid);
	portById.set(pid, port);
	port.onmessage = (ev: MessageEvent<unknown>) => {
		const m = ev.data;
		if (!isPageToSw(m)) return;
		handleMessage(port, m);
	};
	port.onmessageerror = () => undefined;
	// replay all job states to the new connection (refresh recovery)
	for (const rec of jobs.values()) port.postMessage({ t: 'jobStatus', jobId: rec.jobId, phase: rec.phase, url: rec.url, error: rec.error, meta: rec.meta });
};

function handleMessage(port: MessagePort, m: PageToSwMessage): void {
	switch (m.t) {
		case 'addJob': {
			const route = routeByMime(m.mime);
			if (!route) {
				broadcast({ t: 'jobStatus', jobId: m.jobId, phase: 'failed', error: 'unknown_mime' });
				return;
			}
			const rec: JobRec = {
				jobId: m.jobId,
				fileName: m.fileName,
				mime: m.mime,
				file: m.file,
				engine: route.engine,
				phase: route.engine === 'image' ? 'queued' : 'lease-wait',
				opWritten: false,
				cancelled: false,
			};
			jobs.set(m.jobId, rec);
			owners.set(m.jobId, portIds.get(port)!);
			notify(rec);
			if (route.engine === 'image') {
				imageQueue.push(m.jobId);
				pumpImage();
			} else {
				videoQueue.push(m.jobId);
				pumpVideoLeases();
			}
			return;
		}
		case 'cancelJob': {
			const rec = jobs.get(m.jobId);
			if (!rec) return;
			rec.cancelled = true;
			jobs.delete(m.jobId);
			owners.delete(m.jobId);
			const qi = videoQueue.indexOf(m.jobId);
			if (qi >= 0) videoQueue.splice(qi, 1);
			const ii = imageQueue.indexOf(m.jobId);
			if (ii >= 0) imageQueue.splice(ii, 1);
			if (rec.leaseId) leases.delete(rec.leaseId);
			broadcast({ t: 'jobRemoved', jobId: m.jobId });
			return;
		}
		case 'retryJob':
			onRetry(m.jobId);
			return;
		case 'leaseHeartbeat': {
			const lease = leases.get(m.leaseId);
			if (lease) lease.lastBeat = Date.now();
			return;
		}
		case 'leaseRelease': {
			const lease = leases.get(m.leaseId);
			if (lease) {
				leases.delete(m.leaseId);
				const rec = jobs.get(lease.jobId);
				if (rec && rec.leaseId === m.leaseId) rec.leaseId = undefined;
			}
			pumpVideoLeases();
			return;
		}
		case 'videoProgress': {
			const rec = jobs.get(m.jobId);
			if (rec) notify(rec, { fraction: Math.max(0, Math.min(1, m.fraction)) });
			return;
		}
		case 'videoResult': {
			const rec = jobs.get(m.jobId);
			if (rec && rec.phase === 'transcoding') onVideoResult(rec, m.blob, m.width, m.height, m.hasAudio);
			else pumpVideoLeases();
			return;
		}
		case 'videoFailed': {
			const rec = jobs.get(m.jobId);
			if (rec && rec.phase === 'transcoding') onVideoFailed(rec, m.error);
			else pumpVideoLeases();
			return;
		}
		case 'opWritten': {
			const rec = jobs.get(m.jobId);
			if (rec) rec.opWritten = true;
			return;
		}
		case 'poolHint': {
			videoLimit = videoPoolSize(m);
			pumpVideoLeases();
			return;
		}
	}
}
