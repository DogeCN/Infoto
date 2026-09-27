// OPFS artifact read/write: artifacts land on disk and pair with sha256 dedupe.

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

/**
 * Write to OPFS while hashing the same stream — one pass, two uses; hashing completes when the artifact lands.
 *
 * `onBytes` forwards the tee loop's cumulative byte count; the caller owns the
 * denominator (the artifact's own size is known before the loop starts, so no second
 * measuring pass is needed to know how far along it is).
 */
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
        // TS 5.7+ parameterizes Uint8Array over ArrayBufferLike;
        // FileSystemWriteChunkType requires ArrayBuffer (not SharedArrayBuffer).
        // hashBlob chunks come from Blob.stream, backed by ArrayBuffer — safe cast.
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
