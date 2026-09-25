// OPFS artifact read/write (spec "本地持久化"): artifacts land on disk and
// pair with sha256 dedupe.

import { hashBlob } from './hash';

/** Artifact directory: /infoto-artifacts. */
const DIR = 'infoto-artifacts';

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

export interface StoredArtifact {
  blob: Blob;
  sha256: string;
  width: number;
  height: number;
  type: 0 | 1 | 2;
}

/** Artifact filename: {jobId}.{ext} (jobId is local-only, unrelated to media ids). */
export function artifactPath(jobId: string, ext: 'webp' | 'webm'): string {
  return `${jobId}.${ext}`;
}

/**
 * Write to OPFS while hashing the same stream (one pass, two uses).
 * Hashing completes when the artifact lands.
 */
export async function storeArtifact(
  jobId: string,
  blob: Blob,
  ext: 'webp' | 'webm',
): Promise<{ sha256: string; bytes: number }> {
  const dir = await getDir();
  const handle = await dir.getFileHandle(artifactPath(jobId, ext), { create: true });
  const writable = await handle.createWritable();
  const { sha256, bytes } = await hashBlob(blob, async (chunk) => {
    // TS 5.7+ parameterizes Uint8Array over ArrayBufferLike;
    // FileSystemWriteChunkType requires ArrayBuffer (not SharedArrayBuffer).
    // hashBlob chunks come from Blob.stream, backed by ArrayBuffer — safe cast.
    await writable.write(chunk as unknown as FileSystemWriteChunkType);
  });
  await writable.close();
  return { sha256, bytes };
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
