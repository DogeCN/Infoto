// Downloads. In-app downloads fetch the image-host URL directly (browser cache
// preferred); one file is named `{id36}.webp|.webm`, several are packed into
// download.zip (streaming fflate), entries named by sort index, zero-padded.

import { Zip, ZipPassThrough } from 'fflate';
import type { Photo } from '$shared/types';
import { extOfType, padName } from '$base/lib/format';
import { toId36 } from '$base/lib/id36';

/** Make the browser save a Blob. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release only after the browser finished the download
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Single download: filename `{id36}.{ext}`. */
export async function downloadOne(photo: Photo, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(photo.url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  saveBlob(blob, `${toId36(photo.id)}.${extOfType(photo.type)}`);
}

/** Pack several photos into download.zip. `photos` must follow the current sort
 * order — the index is the array position. fflate's streaming Zip writes each file
 * as soon as it downloads, so they never all sit in memory at once. */
export async function downloadZip(photos: Photo[], fetchFn: typeof fetch = fetch): Promise<void> {
  const total = photos.length;
  if (total === 0) return;

  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });

  for (let i = 0; i < total; i++) {
    const photo = photos[i]!;
    const res = await fetchFn(photo.url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = padName(i, total, extOfType(photo.type));
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  }
  zip.end();

  // Zip's end() synchronously flushes every chunk
  saveBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), 'download.zip');
}
