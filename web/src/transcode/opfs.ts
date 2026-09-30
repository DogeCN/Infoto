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
