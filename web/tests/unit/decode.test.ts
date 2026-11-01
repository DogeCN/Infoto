import { test } from 'vitest';
import assert from 'node:assert/strict';
import { forgetDecoded, hasDecoded, markDecoded } from '../../src/state/decode.svelte';

// The record is module-level page state; each case starts by clearing what it touched.
// Reactivity itself is the store's contract with Svelte (a $state Set, per-entry tracked);
// these cases pin the record's semantics, which is what both surfaces read.

test('decode: a URL decoded on one surface reads as decoded on every other', () => {
  assert.equal(hasDecoded('a'), false, 'nothing is decoded before any element fires');
  markDecoded('a');
  assert.equal(hasDecoded('a'), true, 'the viewer decoding a photo counts for its card too');
  assert.equal(hasDecoded('b'), false, 'another URL is unaffected');
  forgetDecoded('a');
});

test('decode: marking is idempotent', () => {
  markDecoded('a');
  markDecoded('a');
  assert.equal(hasDecoded('a'), true);
  forgetDecoded('a');
});

test('decode: an empty or absent URL is never recorded', () => {
  // An upload still in flight has no URL yet; it must keep its skeleton instead of reading
  // as "decoded" and rendering an <img> whose instant error flips the card to the fallback.
  assert.equal(hasDecoded(''), false);
  assert.equal(hasDecoded(null), false);
  assert.equal(hasDecoded(undefined), false);
  markDecoded('');
  markDecoded(null);
  markDecoded(undefined);
  assert.equal(hasDecoded(''), false, 'nothing was recorded');
});

test('decode: a failed URL can be forgotten so the failure path runs again', () => {
  markDecoded('a');
  forgetDecoded('a');
  assert.equal(hasDecoded('a'), false);
  // Forgetting a URL that was never decoded is a no-op.
  forgetDecoded('never');
  assert.equal(hasDecoded('never'), false);
});
