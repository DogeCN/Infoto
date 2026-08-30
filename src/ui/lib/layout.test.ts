// Unit tests for the layout engine — run via `npm run test:layout`
// (node --test, native TS type stripping).

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, orderByMain, windowIndices, type LayoutItem } from './layout.ts';

const items = (specs: [number, number][]): LayoutItem[] =>
	specs.map(([w, h], i) => ({ id: i + 1, w, h }));

test('justified ↓: rows are equal-height and fill the cross size', () => {
	const res = computeLayout(items([[400, 300], [300, 300], [500, 300], [600, 300], [200, 300]]), {
		dir: 'v',
		strategy: 'sequential',
		cross: 1000,
		band: 320,
		gap: 8,
	});
	assert.equal(res.boxes.length, 5);
	// group by row
	const rows = new Map<number, typeof res.boxes>();
	for (const b of res.boxes) {
		const key = Math.round(b.y);
		if (!rows.has(key)) rows.set(key, []);
		rows.get(key)!.push(b);
	}
	for (const [, row] of rows) {
		const hs = new Set(row.map((b) => Math.round(b.h * 100)));
		assert.equal(hs.size, 1, 'all boxes in a row share one height');
	}
	// full rows span the container width (modulo rounding)
	const firstRow = [...rows.values()][0];
	if (firstRow.length > 1) {
		const span = Math.max(...firstRow.map((b) => b.x + b.w));
		assert.ok(Math.abs(span - 1000) < 1.5, `first row spans cross size, got ${span}`);
	}
	assert.equal(res.totalW, 1000);
	assert.ok(res.totalH > 0);
});

test('justified ↓: strict reading order left→right, top→down', () => {
	const res = computeLayout(items([[300, 200], [300, 200], [300, 200], [300, 200], [300, 200], [300, 200]]), {
		dir: 'v',
		strategy: 'sequential',
		cross: 900,
		band: 300,
		gap: 0,
	});
	for (let i = 1; i < res.boxes.length; i++) {
		const a = res.boxes[i - 1];
		const b = res.boxes[i];
		assert.ok(b.y > a.y || (b.y === a.y && b.x > a.x), 'order preserved');
	}
});

test('masonry ↓: fixed column width, items placed into shortest column', () => {
	const res = computeLayout(items([[100, 100], [100, 300], [100, 200], [100, 150], [100, 250]]), {
		dir: 'v',
		strategy: 'shortest',
		cross: 900,
		band: 300,
		gap: 10,
	});
	// 3 columns of width 286.(6)
	assert.equal(res.boxes.length, 5);
	const colW = (900 - 2 * 10) / 3;
	for (const b of res.boxes) assert.ok(Math.abs(b.w - colW) < 1e-6, 'column width fixed');
	// item 2 (tallest) must start in a fresh column, item 3 goes to a shorter one
	const byId = new Map(res.boxes.map((b) => [b.id, b]));
	assert.equal(byId.get(2)!.y, 0);
	// no vertical overlap within a column
	const cols = new Map<number, typeof res.boxes>();
	for (const b of res.boxes) {
		const key = Math.round(b.x);
		if (!cols.has(key)) cols.set(key, []);
		cols.get(key)!.push(b);
	}
	for (const [, list] of cols) {
		list.sort((a, b) => a.y - b.y);
		for (let i = 1; i < list.length; i++) {
			assert.ok(list[i].y >= list[i - 1].y + list[i - 1].h - 1e-6, 'no overlap');
		}
	}
});

test('justified →: columns are equal-width and fill container height', () => {
	const res = computeLayout(items([[300, 400], [300, 300], [300, 500], [300, 600], [300, 200]]), {
		dir: 'h',
		strategy: 'sequential',
		cross: 1000,
		band: 320,
		gap: 8,
	});
	assert.equal(res.boxes.length, 5);
	const cols = new Map<number, typeof res.boxes>();
	for (const b of res.boxes) {
		const key = Math.round(b.x);
		if (!cols.has(key)) cols.set(key, []);
		cols.get(key)!.push(b);
	}
	for (const [, col] of cols) {
		const ws = new Set(col.map((b) => Math.round(b.w * 100)));
		assert.equal(ws.size, 1, 'all boxes in a column share one width');
	}
	assert.equal(res.totalH, 1000);
	assert.ok(res.totalW > 0);
});

test('masonry →: fixed row height, shortest row first', () => {
	const res = computeLayout(items([[100, 100], [300, 100], [200, 100], [150, 100], [250, 100]]), {
		dir: 'h',
		strategy: 'shortest',
		cross: 900,
		band: 300,
		gap: 10,
	});
	const rowH = (900 - 2 * 10) / 3;
	for (const b of res.boxes) assert.ok(Math.abs(b.h - rowH) < 1e-6, 'row height fixed');
	// no horizontal overlap within a row
	const rows = new Map<number, typeof res.boxes>();
	for (const b of res.boxes) {
		const key = Math.round(b.y);
		if (!rows.has(key)) rows.set(key, []);
		rows.get(key)!.push(b);
	}
	for (const [, list] of rows) {
		list.sort((a, b) => a.x - b.x);
		for (let i = 1; i < list.length; i++) {
			assert.ok(list[i].x >= list[i - 1].x + list[i - 1].w - 1e-6, 'no overlap');
		}
	}
});

test('single over-wide item shrinks to fit instead of overflowing', () => {
	const res = computeLayout(items([[4000, 300]]), {
		dir: 'v',
		strategy: 'sequential',
		cross: 1000,
		band: 320,
		gap: 8,
	});
	assert.ok(res.boxes[0].w <= 1000 + 1e-6, `width fits: ${res.boxes[0].w}`);
});

test('empty input yields zero extent', () => {
	const res = computeLayout([], { dir: 'v', strategy: 'shortest', cross: 1000, band: 320, gap: 8 });
	assert.equal(res.boxes.length, 0);
	assert.equal(res.totalH, 0);
});

test('windowIndices returns exactly the boxes intersecting the range', () => {
	const res = computeLayout(items(Array.from({ length: 60 }, () => [400, 300])), {
		dir: 'v',
		strategy: 'shortest',
		cross: 1200,
		band: 300,
		gap: 8,
	});
	const order = orderByMain(res.boxes, 'v');
	const maxH = Math.max(...res.boxes.map((b) => b.h));
	const from = 500;
	const to = 1400;
	const got = new Set(windowIndices(res.boxes, order, 'v', from, to, maxH));
	for (const [i, b] of res.boxes.entries()) {
		const hit = b.y + b.h >= from && b.y <= to;
		assert.equal(got.has(i), hit, `box ${i} hit=${hit}`);
	}
});
