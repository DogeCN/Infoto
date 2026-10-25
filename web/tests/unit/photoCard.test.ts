// Guards the failed-media fallback on a gallery card. It is a contract entry with no runtime
// assertion behind it — the component needs a browser and a failing network to exercise — so a
// source-level check is the only thing that fails when someone deletes it. That already happened
// once: 412b6e0 removed it while the commit was about reflow motion, and the grid went silent for
// two weeks without a single test noticing.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const card = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'lib', 'components', 'PhotoCard.svelte'),
  'utf8',
);

/** The markup rendered when the media failed to load, up to the next branch. */
function failedBranch(): string {
  const start = card.indexOf('{#if loadFailed}');
  assert.ok(start >= 0, 'PhotoCard has no loadFailed branch');
  // The media branch is gated on `showMedia` (in the viewport's load band), not on the URL
  // alone — the failure branch must still come first, or a card whose image is out of the
  // band would render a skeleton over the 404.
  const end = card.indexOf('{:else if showMedia}', start);
  assert.ok(end > start, 'the loadFailed branch is not the first media branch');
  return card.slice(start, end);
}

test('photo card: a failed media card shows the glitch 404 rather than a blank surface', () => {
  const branch = failedBranch();
  assert.match(branch, /<GlitchText/, 'the failed branch renders no glyph');
  assert.match(branch, /text=\{failStatus\}/, 'the glyph does not take the failure status');
  assert.match(card, /const failStatus = '404'/, 'failStatus is not 404');
  // The regression this test exists for: a bare surface with nothing to say.
  assert.equal(
    branch.replace(/\s+/g, ' ').includes('<div class="h-full w-full bg-card"></div>'),
    false,
  );
});

test('photo card: the failure glyph is sized for the card it sits in', () => {
  const branch = failedBranch();
  // Container units, not viewport ones: a 90px card and a 400px card are on the same screen.
  assert.match(branch, /cqmin/);
  assert.match(branch, /\[container-type:size\]/);
});

test('photo card: no overlay control lets its click reach the card', () => {
  // The card root is the click target that opens the Lightbox, so a control that bubbles does
  // both things at once. Retry used to open the Lightbox on media that never existed, and
  // dismiss removed the card the handler had just resolved. This pattern is the bug.
  assert.equal(
    /onclick=\{\(\) => on(?:Retry|Dismiss)Upload\?\.\(\)\}/.test(card),
    false,
    'an overlay control calls its action without stopPropagation()',
  );
});

test('photo card: a failed job leaves the skeleton instead of parking on it', () => {
  // The guard used to be `if (overlay?.preview) return`, which treated every local preview as
  // transient. A job that has already failed is not waiting for anything: the card kept its
  // skeleton and its opacity-0 media, so it read as "still loading" forever. The guard now
  // asks whether the job is still running.
  const handler = /function handleMediaError\(\): void\s*\{([\s\S]*?)\n {2}\}/.exec(card);
  assert.ok(handler, 'handleMediaError is missing');
  const body = handler[1]!.replace(/\s+/g, ' ');
  assert.ok(
    body.includes('if (overlay?.preview && !overlay.failed) return;'),
    'the preview guard does not exempt an already-failed job',
  );
  assert.equal(
    /if \(overlay\?\.preview\) return;/.test(card),
    false,
    'the guard still returns on any preview, parking a failed card on the skeleton',
  );
});
