// Guards where a pending card's local preview comes from. The store owns one object URL per
// job and has exactly one source for it — the OPFS artifact. Seeding it from the picked file at
// enqueue looks harmless and is not: the pick's Blob URL dies with the page, so a replayed job
// had no preview, and a GIF card renders <video> (type 1), which cannot decode a GIF, so every
// GIF upload sat on its skeleton for the whole transfer. Neither failure is visible to a unit
// test of the pipeline, so the wiring is asserted here.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const store = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'state', 'uploadStore.svelte.ts'),
  'utf8',
);

/** The body of a top-level function in the store. */
function bodyOf(header: RegExp): string {
  const start = store.search(header);
  assert.ok(start >= 0, `no match for ${header}`);
  const from = store.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < store.length; i++) {
    if (store[i] === '{') depth++;
    else if (store[i] === '}') {
      depth--;
      if (depth === 0) return store.slice(from, i + 1);
    }
  }
  assert.fail(`unterminated body for ${header}`);
}

test('upload preview: the artifact is the only source', () => {
  const ensure = bodyOf(/async function ensureArtifactPreview\(/);
  assert.ok(ensure.includes('readArtifact('), 'the preview does not read the OPFS artifact');
  assert.ok(ensure.includes('previewUrls.set('), 'the artifact read publishes no preview');
});

test('upload preview: the picked file never seeds it', () => {
  const added = bodyOf(/function addFiles\(/);
  assert.equal(
    added.includes('createObjectURL'),
    false,
    'addFiles seeds a preview from the picked file; a card only exists after stage 1, and a GIF cannot render from its own bytes',
  );
});

// The op-log path cannot be unit-tested end to end (the store pulls in the SharedWorker bundle),
// so its wiring is asserted here: the cards a reload shows are read from the durable log through
// the engine and projected by the one pure rule, and the read is never a sync trigger.
test('upload preview: op-log cards are projected from the log, not from a job', () => {
  const refresh = bodyOf(/async function refreshQueuedUploads\(/);
  assert.ok(refresh.includes('engine.queuedOps('), 'the projection does not read the op log');
  assert.ok(refresh.includes('queuedUploadCards('), 'the projection skips the one pure rule');
  assert.equal(
    refresh.includes('previewUrls'),
    false,
    'an op-derived card must not claim an OPFS preview: the artifact is pruned at 30 jobs and the op carries the hosted URL',
  );
});
