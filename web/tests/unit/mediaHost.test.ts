import { test } from 'vitest';
import assert from 'node:assert/strict';
import { currentMediaHost, onMediaHost, publishMediaHost } from '../../src/state/mediaHost.svelte';

/** The module keeps a last-published value; each case starts from the empty state. */
const reset = (): void => publishMediaHost('');

// The facade address fans out to every surface that owns an upload pipeline. The regression
// this guards: with a single slot, the last registrant owned the address and every other
// pipeline never heard it — the admin editor's upload failed with "no upload address
// configured" while the gallery's worked on the same page load.

test('mediaHost: every registered pipeline hears the address, not only the last one', () => {
  reset();
  const gallery: string[] = [];
  const admin: string[] = [];
  const offGallery = onMediaHost((url) => gallery.push(url));
  const offAdmin = onMediaHost((url) => admin.push(url));

  publishMediaHost('https://facade.test');
  assert.deepEqual(gallery, ['https://facade.test']);
  assert.deepEqual(admin, ['https://facade.test'], 'the admin editor needs it too');

  offGallery();
  offAdmin();
});

test('mediaHost: a pipeline mounted after the sync still receives the address', () => {
  reset();
  // A direct `/admin` load mounts the editor pipeline after `welcome` has already arrived.
  publishMediaHost('https://facade.test');
  const late: string[] = [];
  const off = onMediaHost((url) => late.push(url));
  assert.deepEqual(late, ['https://facade.test'], 'the known address is replayed on register');
  off();
});

test('mediaHost: unregistering stops delivery, and publishing again reaches the rest', () => {
  reset();
  const kept: string[] = [];
  const dropped: string[] = [];
  const offKept = onMediaHost((url) => kept.push(url));
  const offDropped = onMediaHost((url) => dropped.push(url));

  publishMediaHost('https://a.test');
  offDropped();
  publishMediaHost('https://b.test');

  assert.deepEqual(kept, ['https://a.test', 'https://b.test']);
  assert.deepEqual(dropped, ['https://a.test'], 'an unmounted surface is not called again');
  offKept();
});

test('mediaHost: the current address is readable, and empty before any sync', () => {
  reset();
  assert.equal(currentMediaHost(), '', 'nothing is known before a sync');
  publishMediaHost('https://c.test');
  assert.equal(currentMediaHost(), 'https://c.test', 'the last published value is kept');
  reset();
});
