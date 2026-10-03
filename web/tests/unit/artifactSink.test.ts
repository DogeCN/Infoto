// The artifact sink streams an encoder's output straight to OPFS while hashing it. The
// digest must describe the file's bytes in file order, even when the muxer back-patches.
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { openArtifactSink } from '../../src/transcode/opfs';

/** sha256("abc") — a fixed vector, so the assertion does not re-run the hasher under test. */
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/** Minimal in-memory stand-in for the File System Access handles the sink uses. */
function fakeStorage() {
  const files = new Map<string, Blob>();
  const removed: string[] = [];

  class FakeWritable {
    private parts = new Map<number, Uint8Array>();
    constructor(private fileName: string) {}
    async write(chunk: { data: Uint8Array; position: number }): Promise<void> {
      this.parts.set(chunk.position, chunk.data);
    }
    async close(): Promise<void> {
      const ordered = [...this.parts.entries()].sort((a, b) => a[0] - b[0]);
      const size = ordered.reduce((max, [pos, data]) => Math.max(max, pos + data.byteLength), 0);
      const out = new Uint8Array(size);
      for (const [pos, data] of ordered) out.set(data, pos);
      files.set(this.fileName, new Blob([out]));
    }
    async abort(): Promise<void> {
      this.parts.clear();
    }
  }

  const dir = {
    getFileHandle: async (fileName: string) => ({
      createWritable: async () => new FakeWritable(fileName),
      getFile: async () => {
        const blob = files.get(fileName);
        if (!blob) throw new Error('not_found');
        return blob;
      },
    }),
    removeEntry: async (fileName: string) => {
      removed.push(fileName);
      files.delete(fileName);
    },
  };

  return {
    files,
    removed,
    install(): void {
      vi.stubGlobal('navigator', {
        storage: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) },
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('artifact sink: hashes the streamed bytes in file order and reports the file size', async () => {
  const storage = fakeStorage();
  storage.install();

  const sink = await openArtifactSink('job-a', 'webm');
  const writer = sink.writable.getWriter();
  await writer.write({ type: 'write', data: enc('a'), position: 0 });
  await writer.write({ type: 'write', data: enc('b'), position: 1 });
  await writer.write({ type: 'write', data: enc('c'), position: 2 });
  // The encoder closing the stream must not close the file: `finish` still owns it.
  await writer.close();

  const result = await sink.finish();
  assert.equal(result.bytes, 3);
  assert.equal(result.sha256, SHA_ABC);
  assert.equal(await storage.files.get('job-a.webm')!.text(), 'abc');
});

test('artifact sink: a back-patched write hashes the finished file, not the arrival order', async () => {
  const storage = fakeStorage();
  storage.install();

  const sink = await openArtifactSink('job-b', 'webm');
  const writer = sink.writable.getWriter();
  await writer.write({ type: 'write', data: enc('a'), position: 0 });
  // A seek forward leaves a gap, then the header is back-filled: the stream is no longer
  // append-only, so accumulating chunks as they arrive would digest "acb".
  await writer.write({ type: 'write', data: enc('c'), position: 2 });
  await writer.write({ type: 'write', data: enc('b'), position: 1 });
  await writer.close();

  const result = await sink.finish();
  assert.equal(result.bytes, 3);
  assert.equal(result.sha256, SHA_ABC);
});

test('artifact sink: abort releases the artifact and deletes the partial file', async () => {
  const storage = fakeStorage();
  storage.install();

  const sink = await openArtifactSink('job-c', 'webm');
  const writer = sink.writable.getWriter();
  await writer.write({ type: 'write', data: enc('partial'), position: 0 });
  await sink.abort();

  assert.deepEqual(storage.removed, ['job-c.webm']);
  assert.equal(storage.files.has('job-c.webm'), false);
});
