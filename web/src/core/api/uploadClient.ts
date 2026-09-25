// /upload client — streaming proxy to the image host (spec: "image-host upload proxy").
// 45s timeout counts as a failed attempt; retry backoff and attempt count
// constants come from the base pipeline.ts.

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
  /** Injected transport (tests); when absent the XHR path is used. */
  fetchFn?: typeof fetch;
  origin?: string;
  /** Timeout override (tests). */
  timeoutMs?: number;
  /** Upload progress 0…1 (XHR upload.onprogress; fetch cannot observe it). */
  onProgress?: (fraction: number) => void;
}

function parseTcResponse(text: string, status: number): UploadResult {
  let json: TcUploadResponse | null;
  try {
    json = JSON.parse(text) as TcUploadResponse;
  } catch {
    json = null;
  }
  if (status < 200 || status >= 300) {
    const code = json?.['error'];
    return {
      ok: false,
      error: typeof code === 'string' ? code : `http_${status}`,
      detail: json?.msg ?? json?.error ?? undefined,
    };
  }
  const data = json?.data;
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, error: 'bad_response', detail: 'missing data field' };
  }
  return { ok: true, url: data };
}

function buildForm(blob: Blob): FormData {
  const ext = blob.type === 'image/webp' ? 'webp' : 'webm';
  const fd = new FormData();
  fd.append('file', blob, `m.${ext}`);
  return fd;
}

/**
 * One /upload attempt (no retry here — retries live in the pipeline layer): the multipart
 * field is fixed `file`, the filename extension follows the artifact type (.webp / .webm).
 * Transport defaults to XHR so progress stays observable (fetch has no upload stream) — the curtain overlay is driven by it; tests inject fetchFn.
 */
export async function postUpload(blob: Blob, io: UploadCallIo = {}): Promise<UploadResult> {
  const origin = io.origin ?? window.location.origin;
  const timeoutMs = io.timeoutMs ?? UPLOAD_TIMEOUT_MS;

  if (io.fetchFn) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await io.fetchFn(`${origin}/upload`, {
        method: 'POST',
        body: buildForm(blob),
        signal: ctrl.signal,
        credentials: 'include',
      });
      return parseTcResponse(await res.text(), res.status);
    } catch (e) {
      // both abort timeouts and network failures count as one failed attempt
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      return { ok: false, error: aborted ? 'timeout' : 'network_error', detail: String(e) };
    } finally {
      clearTimeout(t);
    }
  }

  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${origin}/upload`);
    xhr.timeout = timeoutMs;
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        io.onProgress?.(Math.max(0, Math.min(1, e.loaded / e.total)));
      }
    };
    xhr.onload = () => resolve(parseTcResponse(xhr.responseText, xhr.status));
    xhr.onerror = () => resolve({ ok: false, error: 'network_error', detail: 'xhr error' });
    xhr.ontimeout = () => resolve({ ok: false, error: 'timeout', detail: 'upload timeout' });
    xhr.send(buildForm(blob));
  });
}
