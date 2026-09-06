// /upload client — streaming proxy to the image host (spec: "图床上传代理").
// 45s AbortController timeout counts as a failed attempt; retry backoff and
// attempt count constants come from the base pipeline.ts.

import type { TcUploadResponse } from '$shared/types';
import { UPLOAD_TIMEOUT_MS } from '$base/upload/pipeline';

export interface UploadResultOk {
	ok: true;
	/** Image-host direct URL (response `data` field). */
	url: string;
}

export interface UploadResultErr {
	ok: false;
	/** Stable error codes: timeout / network_error / http_<status> / bad_response. */
	error: string;
	detail?: string;
}

export type UploadResult = UploadResultOk | UploadResultErr;

export interface UploadCallIo {
	fetchFn?: typeof fetch;
	origin?: string;
	/** Timeout override (tests). */
	timeoutMs?: number;
}

/**
 * One /upload attempt (no retry here — retries live in the pipeline layer).
 * multipart field name is fixed `file`; filename extension follows the
 * artifact type: .webp / .webm.
 */
export async function postUpload(blob: Blob, io: UploadCallIo = {}): Promise<UploadResult> {
	const fetchFn = io.fetchFn ?? fetch;
	const origin = io.origin ?? window.location.origin;
	const ext = blob.type === 'image/webp' ? 'webp' : 'webm';
	const fd = new FormData();
	fd.append('file', blob, `m.${ext}`);
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), io.timeoutMs ?? UPLOAD_TIMEOUT_MS);
	try {
		const res = await fetchFn(`${origin}/upload`, {
			method: 'POST',
			body: fd,
			signal: ctrl.signal,
			credentials: 'include',
		});
		let json: TcUploadResponse | null = null;
		try {
			json = (await res.json()) as TcUploadResponse;
		} catch {
			json = null;
		}
		if (!res.ok) {
			const code = json?.['error'];
			return {
				ok: false,
				error: typeof code === 'string' ? code : `http_${res.status}`,
				detail: json?.msg ?? json?.error ?? undefined,
			};
		}
		const data = json?.data;
		if (typeof data !== 'string' || data.length === 0) {
			return { ok: false, error: 'bad_response', detail: 'missing data field' };
		}
		return { ok: true, url: data };
	} catch (e) {
		// both abort timeouts and network failures count as one failed attempt
		const aborted = e instanceof DOMException && e.name === 'AbortError';
		return { ok: false, error: aborted ? 'timeout' : 'network_error', detail: String(e) };
	} finally {
		clearTimeout(t);
	}
}
