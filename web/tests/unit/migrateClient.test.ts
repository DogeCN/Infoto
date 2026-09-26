import { describe, expect, it } from 'vitest';
import { migrateSql, MIGRATE_TIMEOUT_MS, type XhrFactory } from '../../src/core/api/migrateClient';

class FakeUpload {
  onprogress: ((event: ProgressEvent) => void) | null = null;
}

class FakeXhr {
  readonly upload = new FakeUpload();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 200;
  responseText = '';
  response: unknown = null;
  withCredentials = false;
  timeout = 0;
  method = '';
  url = '';
  sentBody: XMLHttpRequestBodyInit | null = null;
  progress: ProgressEvent[] = [];

  constructor(private readonly result: { status: number; body: string }) {}

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: XMLHttpRequestBodyInit | null): void {
    this.sentBody = body;
    const first = { lengthComputable: true, loaded: 2, total: 8 } as ProgressEvent;
    const second = { lengthComputable: true, loaded: 8, total: 8 } as ProgressEvent;
    this.progress = [first, second];
    this.upload.onprogress?.(first);
    this.upload.onprogress?.(second);
    this.status = this.result.status;
    this.responseText = this.result.body;
    this.onload?.();
  }
}

function fakeFile(name: string, body: Uint8Array): File {
  return {
    name,
    size: body.byteLength,
    arrayBuffer: async () => body.buffer,
  } as unknown as File;
}

function factoryFor(xhr: FakeXhr): XhrFactory {
  return () => xhr as unknown as XMLHttpRequest;
}

describe('migrateSql', () => {
  it('reports real upload progress and sends credentials with the unchanged body', async () => {
    const bytes = new Uint8Array([0, 1, 127, 255]);
    const xhr = new FakeXhr({ status: 200, body: JSON.stringify({ ok: true, imported: 2 }) });
    const progress: number[] = [];

    const result = await migrateSql(fakeFile('backup.sql', bytes), {
      xhrFactory: factoryFor(xhr),
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(result).toEqual({ ok: true, response: { ok: true, imported: 2 } });
    expect(progress).toEqual([0.25, 1]);
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/admin/migrate');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.sentBody).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(xhr.sentBody as ArrayBuffer)]).toEqual([...bytes]);
  });

  it('surfaces an HTTP error when the response is not a server result', async () => {
    const xhr = new FakeXhr({ status: 503, body: 'upstream unavailable' });

    const result = await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
      xhrFactory: factoryFor(xhr),
    });

    expect(result).toEqual({
      ok: false,
      kind: 'http',
      message: '服务器返回 HTTP 503',
      status: 503,
    });
  });

  it('surfaces server error details', async () => {
    const xhr = new FakeXhr({
      status: 500,
      body: JSON.stringify({
        ok: false,
        error: 'import failed',
        detail: 'constraint failed',
        statement: 'INSERT INTO photos',
      }),
    });

    const result = await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
      xhrFactory: factoryFor(xhr),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('server');
    expect(result.message).toContain('constraint failed');
    expect(result.message).toContain('INSERT INTO photos');
  });

  it('rejects malformed successful responses', async () => {
    const xhr = new FakeXhr({ status: 200, body: '{not json' });

    const result = await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
      xhrFactory: factoryFor(xhr),
    });

    expect(result).toEqual({
      ok: false,
      kind: 'malformed',
      message: '服务器响应格式无效',
      status: 200,
    });
  });

  it('arms a whole-request deadline (xhr.timeout stayed 0, so a hung import never gave up)', async () => {
    const xhr = new FakeXhr({ status: 200, body: JSON.stringify({ ok: true, imported: 1 }) });

    await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
      xhrFactory: factoryFor(xhr),
    });

    expect(MIGRATE_TIMEOUT_MS).toBe(5 * 60_000);
    expect(xhr.timeout).toBe(MIGRATE_TIMEOUT_MS);
  });

  it('validates the SQL extension and 50 MiB limit before creating a request', async () => {
    let created = 0;
    const xhrFactory: XhrFactory = () => {
      created += 1;
      return new XMLHttpRequest();
    };
    const invalid = await migrateSql(fakeFile('backup.zip', new Uint8Array([1])), { xhrFactory });
    const oversized = await migrateSql(
      { ...fakeFile('backup.sql', new Uint8Array([1])), size: 50 * 1024 * 1024 + 1 },
      { xhrFactory },
    );

    expect(invalid).toMatchObject({ ok: false, kind: 'validation' });
    expect(oversized).toMatchObject({ ok: false, kind: 'validation' });
    expect(created).toBe(0);
  });
});
