// 设置面板与主页面共享的类型与筛选逻辑（spec: "设置侧边栏"）。纯模块，无副作用。

import type { FillStrategy, ScrollDir } from '$base/lib/layout';
import type { Photo } from '$shared/types';

/** 归属筛选的三态：未启用 / 仅含 / 仅不含。 */
export type TriState = 'off' | 'only' | 'exclude';

/** 五个数值范围筛选的键（spec: "范围"）。 */
export type RangeKey = 'heat' | 'likes' | 'dislikes' | 'reports' | 'size';

export const RANGE_KEYS: readonly RangeKey[] = ['heat', 'likes', 'dislikes', 'reports', 'size'];

export const RANGE_LABELS: Record<RangeKey, string> = {
	heat: '热度',
	likes: '喜欢数',
	dislikes: '不喜欢数',
	reports: '请求删除数',
	size: '文件大小',
};

/** 每个范围筛选的当前区间；null 表示未启用（等价于完整动态范围）。 */
export type RangeValue = [number, number];

export interface FilterSettings {
	/** 选中可见的媒体类型（type=0/1/2），至少保留一个。 */
	types: Set<number>;
	ownedByMe: TriState;
	likedByMe: TriState;
	dislikedByMe: TriState;
	reportedByMe: TriState;
	/** 数值范围筛选（双柄）；键缺失 = 未启用。 */
	ranges: Partial<Record<RangeKey, RangeValue>>;
}

export interface LayoutSettings {
	dir: ScrollDir;
	strategy: FillStrategy;
	band: number;
	gap: number;
}

export interface Settings {
	filters: FilterSettings;
	layout: LayoutSettings;
	filtersOpen: boolean;
	layoutOpen: boolean;
}

/** 取某照片在某个范围筛选维度上的取值。热度 = 喜欢数 − 不喜欢数。 */
export function metricOf(photo: Photo, key: RangeKey): number {
	switch (key) {
		case 'heat':
			return photo.likes.length - photo.dislikes.length;
		case 'likes':
			return photo.likes.length;
		case 'dislikes':
			return photo.dislikes.length;
		case 'reports':
			return photo.reports.length;
		case 'size':
			return photo.size;
	}
}

/** 某维度的动态可调范围 [min, max]；无照片时返回 null。 */
export function metricRange(photos: Photo[], key: RangeKey): RangeValue | null {
	if (photos.length === 0) return null;
	let min = Infinity;
	let max = -Infinity;
	for (const p of photos) {
		const v = metricOf(p, key);
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return [min, max];
}

/** 维度是否可筛（有照片且 min ≠ max）——不可筛项渲染为禁用态。 */
export function isFilterable(photos: Photo[], key: RangeKey): boolean {
	const r = metricRange(photos, key);
	return r !== null && r[0] !== r[1];
}

export function defaultFilterSettings(): FilterSettings {
	return {
		types: new Set([0, 1, 2]),
		ownedByMe: 'off',
		likedByMe: 'off',
		dislikedByMe: 'off',
		reportedByMe: 'off',
		ranges: {},
	};
}

export function defaultSettings(): Settings {
	return {
		filters: defaultFilterSettings(),
		layout: { dir: 'v', strategy: 'sequential', band: 320, gap: 8 },
		filtersOpen: true,
		layoutOpen: false,
	};
}

/**
 * 应用全部筛选（AND 关系，spec: "筛选板块"）。
 * 范围筛选用动态范围判定：未启用的维度不参与过滤。
 */
export function applyFilters(photos: Photo[], f: FilterSettings, selfId: number): Photo[] {
	return photos.filter((p) => {
		if (!f.types.has(p.type)) return false;
		if (f.ownedByMe === 'only' && p.uploader !== selfId) return false;
		if (f.ownedByMe === 'exclude' && p.uploader === selfId) return false;
		if (f.likedByMe === 'only' && !p.likes.includes(selfId)) return false;
		if (f.likedByMe === 'exclude' && p.likes.includes(selfId)) return false;
		if (f.dislikedByMe === 'only' && !p.dislikes.includes(selfId)) return false;
		if (f.dislikedByMe === 'exclude' && p.dislikes.includes(selfId)) return false;
		if (f.reportedByMe === 'only' && !p.reports.includes(selfId)) return false;
		if (f.reportedByMe === 'exclude' && p.reports.includes(selfId)) return false;

		for (const key of RANGE_KEYS) {
			const range = f.ranges[key];
			if (!range) continue;
			const v = metricOf(p, key);
			if (v < range[0] || v > range[1]) return false;
		}
		return true;
	});
}

/** 生效筛选条数（顶栏角标计数）。 */
export function countActiveFilters(f: FilterSettings): number {
	let c = 0;
	if (f.types.size < 3) c++;
	if (f.ownedByMe !== 'off') c++;
	if (f.likedByMe !== 'off') c++;
	if (f.dislikedByMe !== 'off') c++;
	if (f.reportedByMe !== 'off') c++;
	for (const key of RANGE_KEYS) if (f.ranges[key]) c++;
	return c;
}
