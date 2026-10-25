// Guards the GIF worker against re-deriving the per-frame duration conversion. The worker
// decodes frames one at a time, so its timings accumulate as it reads them rather than being
// computed up front — but the arithmetic it does by hand is the same fact, and the hand copy
// drifted: `image.duration ?? FALLBACK` keeps a reported `0`, which puts the looping GIF's last
// frame on its predecessor's timestamp (a non-monotonic GOP), and lets `NaN` through into the
// encoder config. A unit test cannot reach a DedicatedWorker body, so the wiring is asserted
// here.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const worker = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'transcode', 'video.worker.ts'),
  'utf8',
);

test('gif worker: the frame duration comes from the shared owner', () => {
  assert.ok(
    worker.includes('frameDurationS(image.duration)'),
    'the worker re-derives the frame duration instead of calling frameDurationS',
  );
  // The two literals that made the drifted copy possible: a bare fallback and a bare 1ms clamp.
  assert.equal(
    worker.includes('?? 100_000'),
    false,
    'the worker holds its own duration fallback; frameDurationS owns that value',
  );
});

test('gif worker: no inline timestamp arithmetic survives beside it', () => {
  assert.equal(
    worker.includes('/ 1e6'),
    false,
    'the worker converts microseconds itself; frameDurationS returns seconds already',
  );
});

// The worker cannot call a table version, so its inline timings are the same fact and must
// stay an accumulation. A `frameIndex * duration` derivation walks backwards as soon as a short
// frame follows a long one, which is the non-monotonic GOP the frame timestamps exist to prevent.
test('gif worker: the timestamp accumulates frame by frame', () => {
  assert.ok(
    worker.includes('timestampS += seconds'),
    'the worker does not accumulate the timestamp; a per-frame derivation is the drift this guards',
  );
  assert.ok(
    worker.includes('timestamp: timestampS'),
    'the encoded sample does not read the accumulator',
  );
  assert.doesNotMatch(
    worker,
    /frameIndex\s*\*/,
    'the worker derives the timestamp from the frame index instead of accumulating it',
  );
  assert.doesNotMatch(
    worker,
    /\bi\s*\*\s*(?:seconds|frameDurationS)/,
    'the worker multiplies the frame index by a duration; timestamps accumulate',
  );
});
