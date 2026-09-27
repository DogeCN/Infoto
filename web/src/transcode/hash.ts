// hash-wasm streaming SHA-256: the hasher is fed as the artifact streams to OPFS,
// so hashing completes when the file lands.

import { createSHA256 } from 'hash-wasm';

export interface TeeResult {
  sha256: string;
  /** Bytes actually written. */
  bytes: number;
}

/**
 * Consume `source`, writing each chunk to the OPFS sink and the hasher; write and hash failures both propagate (the caller marks the job failed).
 *
 * `onBytes` fires after each chunk is written and hashed. Hashing and the OPFS write
 * are one loop, not two stages — the hasher cannot finish before the sink does, and
 * splitting them would report a fraction for a leg that does not exist. So the honest
 * denominator is the source Blob's own size, and `onBytes(bytes)` is the single real
 * measurement this pipeline offers.
 */
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
