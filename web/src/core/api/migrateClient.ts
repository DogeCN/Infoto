export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export type MigrateImportFailureKind =
  | 'validation'
  | 'network'
  | 'http'
  | 'server'
  | 'malformed';

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

export interface MigrateSqlOptions {
  onProgress?: (fraction: number) => void;
  xhrFactory?: XhrFactory;
  endpoint?: string;
  maxBytes?: number;
}

export async function migrateSql(
  file: File,
  options: MigrateSqlOptions = {},
): Promise<MigrateImportResult> {
  const maxBytes = options.maxBytes ?? MAX_IMPORT_BYTES;
  if (!file.name.toLowerCase().endsWith('.sql')) {
    return { ok: false, kind: 'validation', message: '仅支持 .sql 文件' };
  }
  if (file.size > maxBytes) {
    return { ok: false, kind: 'validation', message: '文件不能超过 50 MiB' };
  }

  let body: ArrayBuffer;
  try {
    body = await file.arrayBuffer();
  } catch {
    return { ok: false, kind: 'network', message: '读取文件失败，请重试' };
  }

  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
  let xhr: XMLHttpRequest;
  try {
    xhr = xhrFactory();
    xhr.open('POST', options.endpoint ?? '/admin/migrate');
    xhr.withCredentials = true;
  } catch {
    return { ok: false, kind: 'network', message: '无法创建上传请求' };
  }

  return new Promise<MigrateImportResult>((resolve) => {
    let settled = false;
    const finish = (result: MigrateImportResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (
      kind: MigrateImportFailureKind,
      message: string,
      status?: number,
    ) => finish({ ok: false, kind, message, ...(status === undefined ? {} : { status }) });
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
    xhr.onerror = () => fail('network', '上传失败，请检查网络');
    xhr.onabort = () => fail('network', '上传已取消');
    xhr.ontimeout = () => fail('network', '上传超时，请重试');
    xhr.onload = () => {
      reportProgress(1);
      const status = xhr.status;
      const payload = readPayload(xhr);
      if (status < 200 || status >= 300) {
        if (isServerFailure(payload)) {
          fail('server', formatServerMessage(payload), status);
        } else {
          fail('http', `服务器返回 HTTP ${status}`, status);
        }
        return;
      }
      if (isServerFailure(payload)) {
        fail('server', formatServerMessage(payload), status);
        return;
      }
      if (!isRecord(payload) || payload.ok !== true) {
        fail('malformed', '服务器响应格式无效', status);
        return;
      }
      finish({ ok: true, response: payload as MigrateImportResponse });
    };

    try {
      xhr.send(body);
    } catch {
      fail('network', '上传失败，请检查网络');
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
  return isRecord(value) && (value.ok === false || typeof value.error === 'string' || typeof value.detail === 'string');
}

function formatServerMessage(value: unknown): string {
  if (!isRecord(value)) return '服务器未返回错误详情';
  const details = [value.error, value.detail, value.statement]
    .map((detail) => (typeof detail === 'string' ? detail : ''))
    .map((detail) => detail.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);
  return details.length > 0 ? `导入失败：${details.join(' · ').slice(0, 240)}` : '导入失败：服务器未返回错误详情';
}
