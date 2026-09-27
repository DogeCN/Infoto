import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  computeLayout,
  orderByMain,
  windowIndices,
  type LayoutItem,
} from '../../src/base/lib/layout.ts';

const items = (specs: [number, number][]): LayoutItem[] =>
  specs.map(([w, h], i) => ({ id: i + 1, w, h }));

test('the four layout modes pack without overlap and a lone wide item shrinks', () => {
  const justified = computeLayout(
    items([
      [400, 300],
      [300, 300],
      [500, 300],
      [600, 300],
      [200, 300],
    ]),
    { dir: 'v', strategy: 'sequential', cross: 1000, band: 320, gap: 8 },
  );
  assert.equal(justified.boxes.length, 5);
  assert.equal(justified.totalW, 1000);
  const rows = new Map<number, typeof justified.boxes>();
  for (const b of justified.boxes) {
    const key = Math.round(b.y);
    rows.set(key, [...(rows.get(key) ?? []), b]);
  }
  for (const row of rows.values()) {
    assert.equal(new Set(row.map((b) => Math.round(b.h * 100))).size, 1);
  }
  const first = [...rows.values()][0]!;
  if (first.length > 1) {
    assert.ok(Math.abs(Math.max(...first.map((b) => b.x + b.w)) - 1000) < 1.5);
  }

  const order = computeLayout(
    items([
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
    ]),
    { dir: 'v', strategy: 'sequential', cross: 900, band: 300, gap: 0 },
  );
  for (let i = 1; i < order.boxes.length; i++) {
    const a = order.boxes[i - 1]!;
    const b = order.boxes[i]!;
    assert.ok(b.y > a.y || (b.y === a.y && b.x > a.x));
  }

  const masonry = computeLayout(
    items([
      [100, 100],
      [100, 300],
      [100, 200],
      [100, 150],
      [100, 250],
    ]),
    { dir: 'v', strategy: 'shortest', cross: 900, band: 300, gap: 10 },
  );
  const colW = (900 - 20) / 3;
  for (const b of masonry.boxes) assert.ok(Math.abs(b.w - colW) < 1e-6);
  assert.equal(masonry.boxes.find((b) => b.id === 2)!.y, 0);

  const horizontal = computeLayout(
    items([
      [300, 400],
      [300, 300],
      [300, 500],
      [300, 600],
      [300, 200],
    ]),
    { dir: 'h', strategy: 'sequential', cross: 1000, band: 320, gap: 8 },
  );
  assert.equal(horizontal.totalH, 1000);
  const hRows = computeLayout(
    items([
      [100, 100],
      [300, 100],
      [200, 100],
      [150, 100],
      [250, 100],
    ]),
    { dir: 'h', strategy: 'shortest', cross: 900, band: 300, gap: 10 },
  );
  const rowH = (900 - 20) / 3;
  for (const b of hRows.boxes) assert.ok(Math.abs(b.h - rowH) < 1e-6);

  const wide = computeLayout(items([[4000, 300]]), {
    dir: 'v',
    strategy: 'sequential',
    cross: 1000,
    band: 320,
    gap: 8,
  });
  assert.ok(wide.boxes[0]!.w <= 1000 + 1e-6);
  const empty = computeLayout([], {
    dir: 'v',
    strategy: 'shortest',
    cross: 1000,
    band: 320,
    gap: 8,
  });
  assert.equal(empty.boxes.length, 0);
  assert.equal(empty.totalH, 0);
});

test('windowIndices returns exactly the boxes in range', () => {
  const res = computeLayout(items(Array.from({ length: 60 }, () => [400, 300])), {
    dir: 'v',
    strategy: 'shortest',
    cross: 1200,
    band: 300,
    gap: 8,
  });
  const order = orderByMain(res.boxes, 'v');
  const maxH = Math.max(...res.boxes.map((b) => b.h));
  const got = new Set(windowIndices(res.boxes, order, 'v', 500, 1400, maxH));
  for (const [i, b] of res.boxes.entries()) {
    assert.equal(got.has(i), b.y + b.h >= 500 && b.y <= 1400);
  }
});
