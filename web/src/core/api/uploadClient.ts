// /upload client — streaming proxy to the image host (spec: "image-host upload proxy").
// One attempt per call: no retry here (the contract forbids automatic retries — a
// failure is surfaced and the manual retry handle takes over). The 45s budget is an
// idle/no-progress deadline from the base pipeline.ts, not a wall-clock cap.

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
  /** Injected XHR transport (tests); defaults to the real XMLHttpRequest. */
  xhrFactory?: () => XMLHttpRequest;
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
    const xhr = (io.xhrFactory ?? (() => new XMLHttpRequest()))();
    xhr.open('POST', `${origin}/upload`);
    xhr.withCredentials = true;
    // XHR's built-in `timeout` measures the WHOLE attempt (connect + body + response),
    // so a 100MB artifact on a <2 Mbps uplink was guaranteed to die at 45s even while
    // every byte was still moving — and the contract has no automatic retry, so that
    // was a permanent failure. Watch for silence instead: the attempt only fails after
    // `timeoutMs` with no progress at all (dead connection, stalled stream, silent
    // response). Progress keeps re-arming the watchdog for as long as it flows.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (result: UploadResult): void => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      resolve(result);
    };
    const arm = (): void => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        xhr.abort();
        settle({ ok: false, error: 'timeout', detail: 'no progress before deadline' });
      }, timeoutMs);
    };
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        io.onProgress?.(Math.max(0, Math.min(1, e.loaded / e.total)));
      }
      arm();
    };
    xhr.onload = () => settle(parseTcResponse(xhr.responseText, xhr.status));
    xhr.onerror = () => settle({ ok: false, error: 'network_error', detail: 'xhr error' });
    // Abort only ever comes from the watchdog above (nothing else cancels it).
    xhr.onabort = () =>
      settle({ ok: false, error: 'timeout', detail: 'no progress before deadline' });
    arm();
    try {
      xhr.send(buildForm(blob));
    } catch (e) {
      // a throw here used to leave the promise pending forever, which wedged the
      // SharedWorker's image pool (its running counter never came back down)
      settle({ ok: false, error: 'network_error', detail: String(e) });
    }
  });
}
