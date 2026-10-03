// OPFS artifact read/write: artifacts land on disk and pair with sha256 dedupe.

import { createSHA256 } from 'hash-wasm';
import { hashBlob } from './hash';

/** Artifact directory: /infoto-artifacts. */
const DIR = 'infoto-artifacts';

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** Artifact filename: {jobId}.{ext} (jobId is local-only, unrelated to media ids). */
export function artifactPath(jobId: string, ext: 'webp' | 'webm'): string {
  return `${jobId}.${ext}`;
}

/** Write the artifact to OPFS while hashing its stream and reporting cumulative bytes. */
export async function storeArtifact(
  jobId: string,
  blob: Blob,
  ext: 'webp' | 'webm',
  onBytes?: (bytes: number) => void,
): Promise<{ sha256: string; bytes: number }> {
  const dir = await getDir();
  const handle = await dir.getFileHandle(artifactPath(jobId, ext), { create: true });
  const writable = await handle.createWritable();
  try {
    const { sha256, bytes } = await hashBlob(
      blob,
      async (chunk) => {
        // Blob stream chunks are ArrayBuffer-backed file-write data.
        await writable.write(chunk as unknown as FileSystemWriteChunkType);
      },
      onBytes,
    );
    await writable.close();
    return { sha256, bytes };
  } catch (e) {
    // A failed write must not leave the artifact locked in OPFS.
    await writable.abort().catch(() => undefined);
    throw e;
  }
}

/** Read an artifact (upload stage 2). */
export async function readArtifact(jobId: string, ext: 'webp' | 'webm'): Promise<Blob | null> {
  try {
    const dir = await getDir();
    const handle = await dir.getFileHandle(artifactPath(jobId, ext), { create: false });
    const file = await handle.getFile();
    return file;
  } catch {
    return null;
  }
}

/** Delete an artifact (only on cancel; failed jobs must keep theirs). */
export async function removeArtifact(jobId: string, ext: 'webp' | 'webm'): Promise<void> {
  try {
    const dir = await getDir();
    await dir.removeEntry(artifactPath(jobId, ext));
  } catch {
    // missing file counts as deleted
  }
}

/** One positioned write, mirroring mediabunny's `StreamTargetChunk` so a `StreamTarget` can
 *  feed this sink directly. `ArrayBuffer` (not the wider `ArrayBufferLike`) is what the File
 *  System Access write takes. */
export interface ArtifactChunk {
  type: 'write';
  data: Uint8Array<ArrayBuffer>;
  position: number;
}

export interface ArtifactSink {
  /** Hand to `new StreamTarget(sink.writable)`: every encoded chunk lands on disk as it is
   *  produced, so the artifact never exists in memory as a whole. */
  writable: WritableStream<ArtifactChunk>;
  /** Close the file and report its digest. Call once the encoder has finalized. */
  finish: () => Promise<{ sha256: string; bytes: number }>;
  /** Abandon the write: release the handle and delete the partial file. Idempotent. */
  abort: () => Promise<void>;
}

/**
 * Stream an artifact straight to OPFS while hashing it, instead of building the whole file
 * in memory and hashing it afterwards. Chunks carry a file position because the muxer may
 * seek back to back-patch a header; the digest is only accumulated while each chunk
 * continues the byte stream seen so far, and a seek falls back to hashing the finished file.
 */
export async function openArtifactSink(jobId: string, ext: 'webp' | 'webm'): Promise<ArtifactSink> {
  const dir = await getDir();
  const handle = await dir.getFileHandle(artifactPath(jobId, ext), { create: true });
  const file = await handle.createWritable();
  const hasher = await createSHA256();
  hasher.init();
  let expected = 0;
  let sequential = true;
  let bytes = 0;
  let settled = false;

  const writable = new WritableStream<ArtifactChunk>({
    async write(chunk) {
      await file.write({ type: 'write', data: chunk.data, position: chunk.position });
      bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      if (chunk.position === expected) {
        hasher.update(chunk.data);
        expected += chunk.data.byteLength;
      } else {
        sequential = false;
      }
    },
    // The encoder closing the stream must not close the file: `finish` owns that, so the
    // digest and the byte count stay available after the encoder is done.
    async close() {},
    async abort() {
      await file.abort().catch(() => undefined);
    },
  });

  return {
    writable,
    async finish() {
      await file.close();
      settled = true;
      if (sequential) return { sha256: hasher.digest('hex'), bytes };
      // A back-patched header makes the in-stream digest wrong; read the file back instead.
      const stored = await readArtifact(jobId, ext);
      if (!stored) throw new Error('artifact_missing');
      return hashBlob(stored);
    },
    async abort() {
      if (settled) return;
      settled = true;
      await file.abort().catch(() => undefined);
      await removeArtifact(jobId, ext);
    },
  };
}
