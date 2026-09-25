// hash-wasm streaming SHA-256 (spec "哈希"): the hasher is fed while the
// artifact streams to OPFS — hashing completes when the file lands.

import { createSHA256 } from 'hash-wasm';

export interface TeeResult {
  sha256: string;
  /** Bytes actually written. */
  bytes: number;
}

/**
 * Consume `source`, writing each chunk simultaneously to the OPFS sink and
 * the hasher. Write and hash failures both propagate (caller marks the job failed).
 */
export async function teeToHash(
  source: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<void>,
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
): Promise<TeeResult> {
  return teeToHash(blob.stream() as ReadableStream<Uint8Array>, write ?? (async () => {}));
}
