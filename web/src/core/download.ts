// 下载（spec: "下载"）。站内下载直接 fetch 图床 URL（优先浏览器缓存），
// 单张文件名 `{id36}.webp|.webm`；多张本地打包 download.zip（fflate 流式），
// 内部文件按已选项当前排序序号命名、高位补零。

import { Zip, ZipPassThrough } from 'fflate';
import type { Photo } from '$shared/types';
import { extOfType, padName } from '$base/lib/format';
import { toId36 } from './id36';

/** 触发浏览器保存一个 Blob。 */
function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// 交给浏览器完成下载后再释放
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 单张下载：文件名 `{id36}.{ext}`。 */
export async function downloadOne(photo: Photo, fetchFn: typeof fetch = fetch): Promise<void> {
	const res = await fetchFn(photo.url, { cache: 'force-cache' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const blob = await res.blob();
	saveBlob(blob, `${toId36(photo.id)}.${extOfType(photo.type)}`);
}

/**
 * 多张打包为 download.zip。`photos` 须已按当前排序排好 —— 序号即数组下标。
 * 用 fflate 的流式 Zip：每张下载完成后立即写入，避免在内存里同时驻留全部文件。
 */
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

	// Zip 的 end() 同步回调全部 chunk
	saveBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), 'download.zip');
}
