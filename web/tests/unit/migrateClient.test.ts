import { test } from 'vitest';
import assert from 'node:assert/strict';
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

test('migrateSql: uploads the unchanged body, reports progress, and rejects bad responses', async () => {
  const bytes = new Uint8Array([0, 1, 127, 255]);
  const xhr = new FakeXhr({ status: 200, body: JSON.stringify({ ok: true, imported: 2 }) });
  const progress: number[] = [];
  assert.deepEqual(
    await migrateSql(fakeFile('backup.sql', bytes), {
      xhrFactory: factoryFor(xhr),
      onProgress: (fraction) => progress.push(fraction),
    }),
    { ok: true, response: { ok: true, imported: 2 } },
  );
  assert.deepEqual(progress, [0.25, 1]);
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/admin/migrate');
  assert.equal(xhr.withCredentials, true);
  assert.deepEqual([...new Uint8Array(xhr.sentBody as ArrayBuffer)], [...bytes]);
  assert.equal(MIGRATE_TIMEOUT_MS, 5 * 60_000);
  assert.equal(xhr.timeout, MIGRATE_TIMEOUT_MS);

  assert.deepEqual(
    await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
      xhrFactory: factoryFor(new FakeXhr({ status: 503, body: 'upstream unavailable' })),
    }),
    {
      ok: false,
      kind: 'http',
      message: 'Server returned HTTP 503',
      status: 503,
    },
  );
  const server = await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
    xhrFactory: factoryFor(
      new FakeXhr({
        status: 500,
        body: JSON.stringify({
          ok: false,
          error: 'import failed',
          detail: 'constraint failed',
          statement: 'INSERT INTO photos',
        }),
      }),
    ),
  });
  assert.equal(server.ok, false);
  if (!server.ok) {
    assert.equal(server.kind, 'server');
    assert.ok(server.message.includes('constraint failed'));
    assert.ok(server.message.includes('INSERT INTO photos'));
  }
  const malformed = await migrateSql(fakeFile('backup.sql', new Uint8Array([1])), {
    xhrFactory: factoryFor(new FakeXhr({ status: 200, body: '{not json' })),
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.kind, 'malformed');
    assert.equal(malformed.status, 200);
  }
});

test('migrateSql: rejects the wrong extension and an oversized file before opening a request', async () => {
  let created = 0;
  const xhrFactory: XhrFactory = () => {
    created += 1;
    return new XMLHttpRequest();
  };
  const wrongExtension = await migrateSql(fakeFile('backup.zip', new Uint8Array([1])), {
    xhrFactory,
  });
  assert.equal(wrongExtension.ok, false);
  if (!wrongExtension.ok) {
    assert.equal(wrongExtension.kind, 'validation');
  }
  const oversized = await migrateSql(
    { ...fakeFile('backup.sql', new Uint8Array([1])), size: 50 * 1024 * 1024 + 1 },
    { xhrFactory },
  );
  assert.equal(oversized.ok, false);
  if (!oversized.ok) {
    assert.equal(oversized.kind, 'validation');
  }
  assert.equal(created, 0);
});
