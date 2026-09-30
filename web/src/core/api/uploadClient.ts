// Single-attempt upload transport with an idle-progress deadline and caller-controlled retry.

import type { MediaHostUploadResponse } from '$shared/types';
import { UPLOAD_TIMEOUT_MS } from '$base/upload/pipeline';

export interface UploadResultOk {
  ok: true;
  /** Facade URL (response `data` field) — what gets stored in photos.url. */
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
  /** Facade base URL from the /sync response. */
  mediaHostUrl?: string;
  /** Timeout override (tests). */
  timeoutMs?: number;
  /** Upload progress 0…1 (XHR upload.onprogress; fetch cannot observe it). */
  onProgress?: (fraction: number) => void;
  /** External cancel (a job removed from the panel): aborts the attempt at once. */
  signal?: AbortSignal;
  /** Multipart file name override — the album already knows its artifact extension;
   *  without it the name is derived from the blob's own MIME (editor source files). */
  fileName?: string;
  /** Injected XHR transport (tests); defaults to the real XMLHttpRequest. */
  xhrFactory?: () => XMLHttpRequest;
}

/** Facade endpoint. Falls back to the local simulation when /sync has not answered yet. */
function uploadEndpoint(mediaHostUrl: string | undefined): string {
  return `${mediaHostUrl ?? 'http://127.0.0.1:8788'}/upload`;
}

function parseMediaHostResponse(text: string, status: number): UploadResult {
  let json: MediaHostUploadResponse | null;
  try {
    json = JSON.parse(text) as MediaHostUploadResponse;
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

/** Choose the multipart filename extension from the Blob MIME type. */
function extFor(blob: Blob): string {
  const mime = (blob.type || '').toLowerCase().split(';')[0]!.trim();
  const known: Record<string, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
  };
  const hit = known[mime];
  if (hit) return hit;
  const subtype = mime.split('/')[1] ?? '';
  return /^[a-z0-9]+$/.test(subtype) ? subtype : 'bin';
}

function buildForm(blob: Blob, fileName?: string): FormData {
  const fd = new FormData();
  fd.append('file', blob, fileName ?? `m.${extFor(blob)}`);
  return fd;
}

/** Upload one multipart file with observable XHR progress or an injected fetch transport. */
export async function postUpload(blob: Blob, io: UploadCallIo = {}): Promise<UploadResult> {
  if (io.signal?.aborted) return { ok: false, error: 'aborted', detail: 'cancelled' };
  const endpoint = uploadEndpoint(io.mediaHostUrl);
  const timeoutMs = io.timeoutMs ?? UPLOAD_TIMEOUT_MS;

  if (io.fetchFn) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const forward = () => ctrl.abort();
    io.signal?.addEventListener('abort', forward, { once: true });
    try {
      const res = await io.fetchFn(endpoint, {
        method: 'POST',
        body: buildForm(blob, io.fileName),
        signal: ctrl.signal,
        // The facade is a separate origin and must never see this site's session cookie.
        credentials: 'omit',
      });
      return parseMediaHostResponse(await res.text(), res.status);
    } catch (e) {
      // abort (watchdog or an external cancel) and network failures all count as one
      // failed attempt; the pipeline discards the result of a cancelled job anyway
      if (io.signal?.aborted) return { ok: false, error: 'aborted', detail: 'cancelled' };
      const aborted = ctrl.signal.aborted;
      return { ok: false, error: aborted ? 'timeout' : 'network_error', detail: String(e) };
    } finally {
      clearTimeout(t);
      io.signal?.removeEventListener('abort', forward);
    }
  }

  return new Promise<UploadResult>((resolve) => {
    let xhr: XMLHttpRequest;
    try {
      xhr = (io.xhrFactory ?? (() => new XMLHttpRequest()))();
      xhr.open('POST', endpoint);
      // Never attach the session cookie to a cross-origin facade request.
      xhr.withCredentials = false;
    } catch (error) {
      resolve({ ok: false, error: 'network_error', detail: String(error) });
      return;
    }
    // Restart the idle watchdog on progress; sustained transfers have no wall-clock deadline.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    // The watchdog aborts the same XHR the caller can cancel, so onabort must know which
    // one fired: an external cancel is 'aborted', a silent stall is 'timeout'.
    let cancelled = false;
    const settle = (result: UploadResult): void => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      io.signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const cancel = (): void => {
      cancelled = true;
      xhr.abort();
      settle({ ok: false, error: 'aborted', detail: 'cancelled' });
    };
    const arm = (): void => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        xhr.abort();
        settle({ ok: false, error: 'timeout', detail: 'no progress before deadline' });
      }, timeoutMs);
    };
    if (io.signal?.aborted) {
      settle({ ok: false, error: 'aborted', detail: 'cancelled' });
      return;
    }
    io.signal?.addEventListener('abort', cancel, { once: true });
    xhr.upload.onprogress = (e) => {
      if (settled) return;
      if (e.lengthComputable && e.total > 0) {
        io.onProgress?.(Math.max(0, Math.min(1, e.loaded / e.total)));
      }
      arm();
    };
    xhr.onload = () => settle(parseMediaHostResponse(xhr.responseText, xhr.status));
    xhr.onerror = () => settle({ ok: false, error: 'network_error', detail: 'xhr error' });
    xhr.onabort = () =>
      settle(
        cancelled
          ? { ok: false, error: 'aborted', detail: 'cancelled' }
          : { ok: false, error: 'timeout', detail: 'no progress before deadline' },
      );
    arm();
    try {
      xhr.send(buildForm(blob, io.fileName));
    } catch (e) {
      // a throw here must settle the promise or it stays pending forever, wedging the
      // SharedWorker's image pool (its running counter never comes back down)
      settle({ ok: false, error: 'network_error', detail: String(e) });
    }
  });
}
