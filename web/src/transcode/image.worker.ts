// Image transcode kernel — imported as a module by the SharedWorker and executed on the
// SharedWorker thread rather than a nested DedicatedWorker.
// createImageBitmap → OffscreenCanvas → WebP quality 0.95.

import { WEBP_QUALITY } from '$base/upload/pipeline';

export interface ImageTranscodeOk {
  ok: true;
  blob: Blob;
  width: number;
  height: number;
}

export interface ImageTranscodeErr {
  ok: false;
  error: string;
}

export type ImageTranscodeResult = ImageTranscodeOk | ImageTranscodeErr;

/**
 * Image → WebP: a non-`image/webp` blob.type means the environment lacks WebP support, so the upload is rejected; unparsable sources and zero dimensions are rejected too.
 */
export async function transcodeImage(file: Blob): Promise<ImageTranscodeResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'conversion_invalid' };
  }
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) return { ok: false, error: 'conversion_invalid' };
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'canvas_2d_unavailable' };
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    if (blob.type !== 'image/webp') {
      return { ok: false, error: 'webp_encode_unsupported' };
    }
    if (blob.size === 0) return { ok: false, error: 'empty_output' };
    return { ok: true, blob, width: bitmap.width, height: bitmap.height };
  } catch {
    return { ok: false, error: 'webp_encode_unsupported' };
  } finally {
    bitmap.close();
  }
}
