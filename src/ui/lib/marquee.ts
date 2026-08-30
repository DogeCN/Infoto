// Marquee (rubber-band) hit-testing — pure rectangle intersection over
// layout boxes (spec: "多选模式 · 拖动框选").

import type { LayoutBox } from './layout.ts';

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Normalized intersection test (negative w/h allowed). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
	const ax = Math.min(a.x, a.x + a.w);
	const aw = Math.abs(a.w);
	const ay = Math.min(a.y, a.y + a.h);
	const ah = Math.abs(a.h);
	const bx = Math.min(b.x, b.x + b.w);
	const bw = Math.abs(b.w);
	const by = Math.min(b.y, b.y + b.h);
	const bh = Math.abs(b.h);
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Ids of boxes intersecting the marquee rect (content coordinates). */
export function marqueeHits(boxes: LayoutBox[], rect: Rect): number[] {
	const out: number[] = [];
	for (const b of boxes) if (rectsIntersect(rect, b)) out.push(b.id);
	return out;
}
