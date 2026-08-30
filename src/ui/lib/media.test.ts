// Unit tests for phase-4 pure helpers — run via `npm run test:media`
// (node --test, native TS type stripping).

import test from 'node:test';
import assert from 'node:assert/strict';
import { toId36, fromId36, proxyUrl } from './id36.ts';
import { humanSize, padName, extOfType } from './format.ts';
import { marqueeHits, rectsIntersect } from './marquee.ts';

// ---- id36 -------------------------------------------------------------------

test('toId36: spec examples', () => {
	assert.equal(toId36(0), '0');
	assert.equal(toId36(7), '7');
	assert.equal(toId36(35), 'z');
	assert.equal(toId36(36), '10');
	assert.equal(toId36(1295), 'zz');
	assert.equal(toId36(1296), '100');
});

test('toId36: rejects negatives and non-integers', () => {
	assert.throws(() => toId36(-1));
	assert.throws(() => toId36(1.5));
});

test('fromId36: round-trips and rejects garbage', () => {
	for (const id of [0, 1, 35, 36, 12345, Number.MAX_SAFE_INTEGER]) {
		assert.equal(fromId36(toId36(id)), id);
	}
	assert.equal(fromId36('z'), 35);
	assert.equal(fromId36('10'), 36);
	assert.equal(fromId36(''), null);
	assert.equal(fromId36('A'), null);
	assert.equal(fromId36('z-1'), null);
	assert.equal(fromId36('zzzzzzzzzzzzz'), null); // over MAX_SAFE_INTEGER
});

test('proxyUrl: origin + /l/{id36}', () => {
	assert.equal(proxyUrl('https://example.com', 36), 'https://example.com/l/10');
});

// ---- human-readable sizes ----------------------------------------------------

test('humanSize: binary steps', () => {
	assert.equal(humanSize(0), '0 B');
	assert.equal(humanSize(512), '512 B');
	assert.equal(humanSize(1024), '1 KB');
	assert.equal(humanSize(1536), '1.5 KB');
	assert.equal(humanSize(1024 * 1024), '1 MB');
	assert.equal(humanSize(Math.round(1.7 * 1024 ** 3)), '1.7 GB');
	assert.equal(humanSize(2.5 * 1024 ** 4), '2.5 TB');
	assert.equal(humanSize(-5), '0 B');
});

// ---- zero-padded zip names -----------------------------------------------------

test('padName: width follows total digit count', () => {
	assert.equal(padName(0, 9, 'webp'), '1.webp');
	assert.equal(padName(0, 20, 'webp'), '01.webp');
	assert.equal(padName(19, 20, 'webm'), '20.webm');
	assert.equal(padName(0, 100, 'webp'), '001.webp');
	assert.equal(padName(99, 100, 'webm'), '100.webm');
});

test('extOfType: type implies extension', () => {
	assert.equal(extOfType(0), 'webp');
	assert.equal(extOfType(1), 'webm');
	assert.equal(extOfType(2), 'webm');
});

// ---- marquee hit-testing ---------------------------------------------------------

const box = (id: number, x: number, y: number, w = 100, h = 100) => ({ id, x, y, w, h });

test('rectsIntersect: overlap, edge touch, containment, negative dims', () => {
	assert.ok(rectsIntersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 25, y: 25, w: 100, h: 100 }));
	// exact edge touch is NOT a hit
	assert.ok(!rectsIntersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 10, h: 10 }));
	// full containment
	assert.ok(rectsIntersect({ x: 0, y: 0, w: 200, h: 200 }, { x: 50, y: 50, w: 10, h: 10 }));
	// rubber-band drawn bottom-right → top-left (negative w/h)
	assert.ok(rectsIntersect({ x: 100, y: 100, w: -60, h: -60 }, { x: 50, y: 50, w: 20, h: 20 }));
});

test('marqueeHits: returns intersecting box ids only', () => {
	const boxes = [box(1, 0, 0), box(2, 200, 0), box(3, 0, 200), box(4, 200, 200)];
	assert.deepEqual(marqueeHits(boxes, { x: -10, y: -10, w: 120, h: 120 }), [1]);
	assert.deepEqual(marqueeHits(boxes, { x: 0, y: 0, w: 300, h: 300 }), [1, 2, 3, 4]);
	assert.deepEqual(marqueeHits(boxes, { x: 290, y: -50, w: 20, h: 20 }), []);
	// negative-width rubber band still hits
	assert.deepEqual(marqueeHits(boxes, { x: 250, y: 250, w: -180, h: -180 }), [1, 2, 3, 4]);
});
