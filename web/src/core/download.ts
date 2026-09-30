// Downloads. In-app downloads fetch the image-host URL directly (browser cache
// preferred); one file is named `{id36}.webp|.webm`, several are packed into
// download.zip (streaming fflate), entries named by sort index, zero-padded.

import { Zip, ZipPassThrough } from 'fflate';
import type { Photo } from '$shared/types';
import { padName } from '$base/lib/format';
import { toId36, extOfType } from '$shared/media';

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

/** Fetch media directly with browser caching, then try the same-origin proxy on failure. */
async function fetchPhoto(photo: Photo, fetchFn: typeof fetch): Promise<Response> {
  try {
    const res = await fetchFn(photo.url, { cache: 'force-cache' });
    if (res.ok) return res;
    const proxy = await fetchFn(`/l/${toId36(photo.id)}`, { cache: 'force-cache' });
    if (proxy.ok) return proxy;
    return res;
  } catch {
    const proxy = await fetchFn(`/l/${toId36(photo.id)}`, { cache: 'force-cache' });
    if (proxy.ok) return proxy;
    throw new Error('download blocked (direct link + /l/ proxy both failed)');
  }
}

/** Single download: filename `{id36}.{ext}`. */
export async function downloadOne(photo: Photo, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchPhoto(photo, fetchFn);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  saveBlob(blob, `${toId36(photo.id)}.${extOfType(photo.type)}`);
}

/** Download photos sequentially into a ZIP, with zero-padded entry names in display order. */
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
    const res = await fetchPhoto(photo, fetchFn);
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
