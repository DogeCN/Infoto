// Guards the failed-media fallback on the two surfaces that show media: the gallery card and
// the Lightbox. It is a contract entry with no runtime assertion behind it — the component
// needs a browser and a failing network to exercise — so a source-level check is the only
// thing that fails when someone deletes it. That already happened once: 412b6e0 removed it
// while the commit was about reflow motion, and the grid went silent for two weeks without a
// single test noticing.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const card = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'lib', 'components', 'PhotoCard.svelte'),
  'utf8',
);
const lightbox = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'lib', 'components', 'Lightbox.svelte'),
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

test('photo card: a failed media card shows the grey site mark rather than a blank surface', () => {
  const branch = failedBranch();
  // The failure glyph is the site mark in muted grey — quiet, non-glowing, non-animated.
  assert.match(branch, /<SiteIcon/, 'the failed branch renders no site mark');
  assert.match(branch, /text-muted-foreground/, 'the mark is not muted grey');
  assert.doesNotMatch(branch, /GlitchText/, 'the failed branch still renders the glitch 404');
  // The grid raises no toast, so the surface must be spoken — a screen-reader user gets
  // the failure through this label, the only channel the card has.
  assert.match(branch, /role="img"/, 'the failed surface is not announced as an image');
  assert.match(
    branch,
    /aria-label=\{copy\.lightbox\.loadFailed\}/,
    'the failed surface has no label',
  );
  // The regression this test exists for: a bare surface with nothing to say.
  assert.equal(
    branch.replace(/\s+/g, ' ').includes('<div class="h-full w-full bg-card"></div>'),
    false,
  );
});

test('photo card: the failure glyph is sized for the card it sits in', () => {
  const branch = failedBranch();
  // Card width, not viewport width: a 90px card and a 400px card are on the same screen.
  assert.match(branch, /size=\{width < 140 \? 24 : 40\}/);
});

test('Lightbox: the failed surface matches the card — replaces media, same grey mark', () => {
  // Both surfaces that show media follow one rule (§3, broken media): the broken element
  // leaves the DOM (it must not stay opacity-0, clickable and invisible behind a mark),
  // and the solid surface carries the same quiet grey mark, sized from the surface it
  // sits in — the stage's cq box where the card uses its width.
  const start = lightbox.indexOf('{#if loadFailed}');
  assert.ok(start >= 0, 'the Lightbox has no failed branch');
  const failedBlock = lightbox.slice(start, lightbox.indexOf('{:else}', start));
  assert.match(failedBlock, /lb-failed/, 'the failed surface is not a solid box');
  assert.match(
    failedBlock,
    /<SiteIcon[^>]*size="min\(56px, 12cqmin\)"[^>]*text-muted-foreground/,
    'the failed surface carries no stage-sized grey mark',
  );
  // The media elements live in the {:else} arm only: failure means they were unmounted.
  const outer = lightbox.slice(start, lightbox.indexOf('{:else}', start));
  assert.ok(
    !outer.includes('<img') && !outer.includes('<video'),
    'a media element still renders inside the failed branch',
  );
  const elseArm = lightbox.slice(lightbox.indexOf('{:else}', start));
  assert.ok(elseArm.indexOf('<img') >= 0, 'no image element after the failed branch');
  // A failed render has no media to mute, and no decoded record to keep.
  assert.match(
    lightbox,
    /\{#if photo\.type === 2 && !loadFailed\}/,
    'the volume button ignores failure',
  );
  const handler = /function handleMediaError\(url: string\): void\s*\{([\s\S]*?)\n {2}\}/.exec(
    lightbox,
  );
  assert.ok(handler, 'the Lightbox has no handleMediaError');
  assert.match(
    handler[1]!,
    /if \(isPending\) return;/,
    'a still-in-flight preview is judged broken',
  );
  assert.match(handler[1]!, /forgetDecoded\(url\);/, 'the failed URL still counts as decoded');
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
