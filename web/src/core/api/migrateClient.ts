import { copy, fmt } from '$shared/copy';

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export type MigrateImportFailureKind = 'validation' | 'network' | 'http' | 'server' | 'malformed';

export interface MigrateImportResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  statement?: string;
  imported?: number;
  [key: string]: unknown;
}

export type MigrateImportResult =
  | {
      ok: true;
      response: MigrateImportResponse;
    }
  | {
      ok: false;
      kind: MigrateImportFailureKind;
      message: string;
      status?: number;
    };

export type XhrFactory = () => XMLHttpRequest;

/** Whole-request deadline: without it `xhr.timeout` never fires, so a stalled
 * connection leaves `importing` latched forever with no way out. Deliberately
 * generous — the server runs arbitrary SQL inside this window, not just the upload. */
export const MIGRATE_TIMEOUT_MS = 5 * 60_000;

export interface MigrateSqlOptions {
  onProgress?: (fraction: number) => void;
  xhrFactory?: XhrFactory;
  endpoint?: string;
  maxBytes?: number;
  /** Whole-request timeout override (tests). */
  timeoutMs?: number;
}

export async function migrateSql(
  file: File,
  options: MigrateSqlOptions = {},
): Promise<MigrateImportResult> {
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  if (!file.name.toLowerCase().endsWith('.sql')) {
    return { ok: false, kind: 'validation', message: copy.migrate.onlySqlFiles };
  }
  if (file.size > maxBytes) {
    return { ok: false, kind: 'validation', message: copy.migrate.fileTooLarge };
  }

  let body: ArrayBuffer;
  try {
    body = await file.arrayBuffer();
  } catch {
    return { ok: false, kind: 'network', message: copy.migrate.readFileFailed };
  }

  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
  let xhr: XMLHttpRequest;
  try {
    xhr = xhrFactory();
    xhr.open('POST', options.endpoint ?? '/admin/migrate');
    xhr.withCredentials = true;
    xhr.timeout = options.timeoutMs ?? MIGRATE_TIMEOUT_MS;
  } catch {
    return { ok: false, kind: 'network', message: copy.migrate.cannotCreateRequest };
  }

  return new Promise<MigrateImportResult>((resolve) => {
    let settled = false;
    const finish = (result: MigrateImportResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (kind: MigrateImportFailureKind, message: string, status?: number) =>
      finish({ ok: false, kind, message, ...(status === undefined ? {} : { status }) });
    let lastProgress: number | undefined;
    const reportProgress = (fraction: number) => {
      if (lastProgress === fraction) return;
      lastProgress = fraction;
      options.onProgress?.(fraction);
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        reportProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
      }
    };
    xhr.onerror = () => fail('network', copy.migrate.uploadFailedCheckNetwork);
    xhr.onabort = () => fail('network', copy.migrate.uploadCancelled);
    xhr.ontimeout = () => fail('network', copy.migrate.uploadTimeout);
    xhr.onload = () => {
      reportProgress(1);
      const status = xhr.status;
      const payload = readPayload(xhr);
      if (status < 200 || status >= 300) {
        if (isServerFailure(payload)) {
          fail('server', formatServerMessage(payload), status);
        } else {
          fail('http', fmt(copy.migrate.httpError, { status }), status);
        }
        return;
      }
      if (isServerFailure(payload)) {
        fail('server', formatServerMessage(payload), status);
        return;
      }
      if (!isRecord(payload) || payload.ok !== true) {
        fail('malformed', copy.migrate.invalidResponse, status);
        return;
      }
      finish({ ok: true, response: payload as MigrateImportResponse });
    };

    try {
      xhr.send(body);
    } catch {
      fail('network', copy.migrate.uploadFailedCheckNetwork);
    }
  });
}

function readPayload(xhr: XMLHttpRequest): unknown {
  const response = xhr.response;
  if (response && typeof response === 'object') return response;
  const text = typeof xhr.responseText === 'string' ? xhr.responseText : String(response ?? '');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isServerFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.ok === false || typeof value.error === 'string' || typeof value.detail === 'string')
  );
}

function formatServerMessage(value: unknown): string {
  if (!isRecord(value)) return copy.migrate.noErrorDetail;
  const details = [value.error, value.detail, value.statement]
    .map((detail) => (typeof detail === 'string' ? detail : ''))
    .map((detail) => detail.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);
  return details.length > 0
    ? fmt(copy.migrate.serverFailure, { details: details.join(' · ').slice(0, 240) })
    : copy.migrate.serverFailureNoDetail;
}
