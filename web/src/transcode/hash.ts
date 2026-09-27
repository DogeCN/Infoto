// hash-wasm streaming SHA-256: the hasher is fed as the artifact streams to OPFS,
// so hashing completes when the file lands.

import { createSHA256 } from 'hash-wasm';

export interface TeeResult {
  sha256: string;
  /** Bytes actually written. */
  bytes: number;
}

/** Write and hash each source chunk in one pass. Report cumulative bytes after both operations complete; propagate failures. */
export async function teeToHash(
  source: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<void>,
  onBytes?: (bytes: number) => void,
): Promise<TeeResult> {
  const hasher = await createSHA256();
  hasher.init();
  const reader = source.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await write(value);
      hasher.update(value);
      bytes += value.byteLength;
      onBytes?.(bytes);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hasher.digest('hex'), bytes };
}

/** Blob convenience wrapper. */
export async function hashBlob(
  blob: Blob,
  write?: (chunk: Uint8Array) => Promise<void>,
  onBytes?: (bytes: number) => void,
): Promise<TeeResult> {
  return teeToHash(blob.stream() as ReadableStream<Uint8Array>, write ?? (async () => {}), onBytes);
}
