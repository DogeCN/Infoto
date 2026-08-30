// Waterfall layout engine — pure functions, no DOM (spec: "瀑布流").
//
// Four modes = scroll direction (v/h) x fill strategy (sequential/shortest):
//   v + sequential → Justified ↓   equal-height rows, strict left→right top→down
//   v + shortest   → Masonry ↓     equal-width columns, shortest column first
//   h + sequential → Justified →   equal-width columns, strict top→down left→right
//   h + shortest   → Masonry →     equal-height rows, shortest row first
//
// computeLayoutChunked yields to requestAnimationFrame every few hundred
// items so huge albums never produce a long task; the total extent is known
// as soon as the pass finishes, so the scrollbar settles in one shot.

export type ScrollDir = 'v' | 'h';
export type FillStrategy = 'sequential' | 'shortest';

export interface LayoutItem {
	id: number;
	/** Natural width (metadata). */
	w: number;
	/** Natural height (metadata). */
	h: number;
}

export interface LayoutBox {
	id: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LayoutOptions {
	dir: ScrollDir;
	strategy: FillStrategy;
	/** Cross-axis size: container width when dir='v', container height when dir='h'. */
	cross: number;
	/** Target band thickness (row height / column width basis), 200–800. */
	band: number;
	/** Item gap, 0–32. */
	gap: number;
}

export interface LayoutResult {
	boxes: LayoutBox[];
	totalW: number;
	totalH: number;
}

const dim = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 1);

function* vSequential(items: LayoutItem[], cross: number, band: number, gap: number) {
	const targetH = band;
	let y = 0;
	let i = 0;
	while (i < items.length) {
		const row: LayoutItem[] = [];
		let acc = 0;
		let filled = false;
		while (i < items.length) {
			const it = items[i];
			const w = (dim(it.w) / dim(it.h)) * targetH;
			const next = acc + (row.length ? gap : 0) + w;
			if (row.length > 0 && next > cross) {
				filled = true;
				break;
			}
			acc = next;
			row.push(it);
			i++;
		}
		const gaps = (row.length - 1) * gap;
		const sumRatio = row.reduce((s, it) => s + dim(it.w) / dim(it.h), 0);
		// Full rows stretch to exactly fill the cross size; a trailing partial
		// row keeps the target height (and shrinks further only when a single
		// item is wider than the container).
		const h = filled ? (cross - gaps) / sumRatio : Math.min(targetH, (cross - gaps) / sumRatio);
		let x = 0;
		for (const it of row) {
			const w = (dim(it.w) / dim(it.h)) * h;
			yield { id: it.id, x, y, w, h } satisfies LayoutBox;
			x += w + gap;
		}
		y += h + gap;
	}
	return { totalW: cross, totalH: Math.max(0, y - gap) };
}

function* vShortest(items: LayoutItem[], cross: number, band: number, gap: number) {
	const cols = Math.max(1, Math.round((cross + gap) / (band + gap)));
	const colW = (cross - (cols - 1) * gap) / cols;
	const heights = new Array<number>(cols).fill(0);
	for (const it of items) {
		let c = 0;
		for (let k = 1; k < cols; k++) if (heights[k] < heights[c]) c = k;
		const h = (colW * dim(it.h)) / dim(it.w);
		yield { id: it.id, x: c * (colW + gap), y: heights[c], w: colW, h } satisfies LayoutBox;
		heights[c] += h + gap;
	}
	return { totalW: cross, totalH: Math.max(0, Math.max(...heights) - gap) };
}

function* hSequential(items: LayoutItem[], cross: number, band: number, gap: number) {
	const targetW = band;
	let x = 0;
	let i = 0;
	while (i < items.length) {
		const col: LayoutItem[] = [];
		let acc = 0;
		let filled = false;
		while (i < items.length) {
			const it = items[i];
			const h = (dim(it.h) / dim(it.w)) * targetW;
			const next = acc + (col.length ? gap : 0) + h;
			if (col.length > 0 && next > cross) {
				filled = true;
				break;
			}
			acc = next;
			col.push(it);
			i++;
		}
		const gaps = (col.length - 1) * gap;
		const sumInv = col.reduce((s, it) => s + dim(it.h) / dim(it.w), 0);
		const w = filled ? (cross - gaps) / sumInv : Math.min(targetW, (cross - gaps) / sumInv);
		let y = 0;
		for (const it of col) {
			const h = (dim(it.h) / dim(it.w)) * w;
			yield { id: it.id, x, y, w, h } satisfies LayoutBox;
			y += h + gap;
		}
		x += w + gap;
	}
	return { totalW: Math.max(0, x - gap), totalH: cross };
}

function* hShortest(items: LayoutItem[], cross: number, band: number, gap: number) {
	const rows = Math.max(1, Math.round((cross + gap) / (band + gap)));
	const rowH = (cross - (rows - 1) * gap) / rows;
	const widths = new Array<number>(rows).fill(0);
	for (const it of items) {
		let r = 0;
		for (let k = 1; k < rows; k++) if (widths[k] < widths[r]) r = k;
		const w = (rowH * dim(it.w)) / dim(it.h);
		yield { id: it.id, x: widths[r], y: r * (rowH + gap), w, h: rowH } satisfies LayoutBox;
		widths[r] += w + gap;
	}
	return { totalW: Math.max(0, Math.max(...widths) - gap), totalH: cross };
}

type Gen = Generator<LayoutBox, { totalW: number; totalH: number }>;

function layoutGen(items: LayoutItem[], opts: LayoutOptions): Gen {
	const cross = Math.max(1, opts.cross);
	const band = Math.max(1, opts.band);
	const gap = Math.max(0, opts.gap);
	if (opts.dir === 'v') {
		return opts.strategy === 'sequential'
			? vSequential(items, cross, band, gap)
			: vShortest(items, cross, band, gap);
	}
	return opts.strategy === 'sequential'
		? hSequential(items, cross, band, gap)
		: hShortest(items, cross, band, gap);
}

/** Synchronous full pass (used by tests and small sets). */
export function computeLayout(items: LayoutItem[], opts: LayoutOptions): LayoutResult {
	const gen = layoutGen(items, opts);
	const boxes: LayoutBox[] = [];
	let r = gen.next();
	while (!r.done) {
		boxes.push(r.value);
		r = gen.next();
	}
	return { boxes, totalW: r.value.totalW, totalH: r.value.totalH };
}

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
		else setTimeout(resolve, 16);
	});

/**
 * Frame-sliced pass: yields to the event loop every `chunk` boxes
 * (spec: 200–500 per frame). Returns null when `signal` aborts (a newer
 * layout pass superseded this one).
 */
export async function computeLayoutChunked(
	items: LayoutItem[],
	opts: LayoutOptions,
	chunk = 400,
	signal?: AbortSignal,
): Promise<LayoutResult | null> {
	const gen = layoutGen(items, opts);
	const boxes: LayoutBox[] = [];
	let r = gen.next();
	let n = 0;
	while (!r.done) {
		if (signal?.aborted) return null;
		boxes.push(r.value);
		if (++n % chunk === 0) await nextFrame();
		r = gen.next();
	}
	if (signal?.aborted) return null;
	return { boxes, totalW: r.value.totalW, totalH: r.value.totalH };
}

/** Box indices sorted by their main-axis coordinate — feeds the window search. */
export function orderByMain(boxes: LayoutBox[], dir: ScrollDir): number[] {
	const idx = boxes.map((_, i) => i);
	idx.sort((a, b) => (dir === 'v' ? boxes[a].y - boxes[b].y : boxes[a].x - boxes[b].x));
	return idx;
}

/**
 * Indices of boxes intersecting the main-axis interval [from, to].
 * Binary search locates a conservative start (boxes can be at most
 * `maxExtent` long), then a short linear scan filters precisely.
 */
export function windowIndices(
	boxes: LayoutBox[],
	order: number[],
	dir: ScrollDir,
	from: number,
	to: number,
	maxExtent: number,
): number[] {
	const main = (b: LayoutBox): number => (dir === 'v' ? b.y : b.x);
	const extent = (b: LayoutBox): number => (dir === 'v' ? b.h : b.w);
	let lo = 0;
	let hi = order.length;
	const threshold = from - maxExtent;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (main(boxes[order[mid]]) < threshold) lo = mid + 1;
		else hi = mid;
	}
	const out: number[] = [];
	for (let k = lo; k < order.length; k++) {
		const b = boxes[order[k]];
		if (main(b) > to) break;
		if (main(b) + extent(b) >= from) out.push(order[k]);
	}
	return out;
}
