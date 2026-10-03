import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  bubbleTransition,
  motionEase,
  motionEaseFn,
  motionMs,
  reflowFlipWindowMs,
} from '../../src/base/lib/motion';

// Values mirror the `@theme` block in `app.css`; keep the two in step.
const MS = { enter: 280, exit: 160, spring: 420, reflow: 450 };
const EASE = {
  enter: 'cubic-bezier(0.2, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  reflow: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
};
const PHASES = ['enter', 'exit', 'spring', 'reflow'] as const;

test('motion tokens resolve without a document', () => {
  // Every phase must produce a usable value with no DOM: the prefix is added exactly
  // once, so a wrong phase name would miss the fallback table instead of throwing here.
  for (const phase of PHASES) {
    assert.equal(motionMs(phase), MS[phase]);
    assert.equal(motionEase(phase), EASE[phase]);
  }
  assert.deepEqual(bubbleTransition, { y: 3, duration: MS.exit, easing: bubbleTransition.easing });
});

test('the reflow flip window outlasts the reflow it is bracketing', () => {
  // The window decides which remounts still glide. Shorter than the animation itself and
  // a card mounting late in its own transition is treated as a fresh mount and appears at
  // the new box — the half-finished glide `ca1b082` was cited for. It must also be derived
  // from the token, so the assertion is against `motionMs`, not against a restated 450.
  assert.ok(
    reflowFlipWindowMs > motionMs('reflow'),
    `flip window ${reflowFlipWindowMs}ms must exceed the ${motionMs('reflow')}ms reflow`,
  );
});

test('easing functions reproduce the cubic-bezier curves they mirror', () => {
  const sample = (ease: (t: number) => number, n = 100): number[] =>
    Array.from({ length: n + 1 }, (_, i) => ease(i / n));

  for (const phase of PHASES) {
    const ease = motionEaseFn(phase);
    assert.equal(ease(0), 0, `${phase} starts at 0`);
    assert.equal(ease(1), 1, `${phase} settles at 1`);
    // Rises to its peak, then comes back down onto 1. Only the rise is monotonic: a
    // back-out curve's descent is the overshoot that defines the spring.
    const values = sample(ease);
    const peakIndex = values.indexOf(Math.max(...values));
    for (let i = 1; i <= peakIndex; i++) {
      assert.ok(values[i]! >= values[i - 1]!, `${phase} rises to its peak at ${i}`);
    }
  }

  // Enter and exit are the asymmetric pair: both start and end softly, but enter
  // spends its budget late (weight past the midpoint) while exit spends it early.
  const enter = motionEaseFn('enter');
  const exit = motionEaseFn('exit');
  assert.ok(enter(0.5) > 0.5, 'enter is weighted past the midpoint');
  assert.ok(exit(0.5) < 0.5, 'exit is weighted before the midpoint');
  assert.ok(exit(0.1) < enter(0.1), 'exit moves first');

  // Only the spring leaves the unit range.
  assert.ok(Math.max(...sample(exit)) <= 1);
  assert.ok(Math.max(...sample(enter)) <= 1);
  assert.ok(Math.max(...sample(motionEaseFn('spring'))) > 1, 'spring overshoots');
});

test('durations parse both units and reject anything unparseable', () => {
  // `s` and `ms` both appear in CSS; a token in seconds must not read as milliseconds.
  assert.equal(motionMs('spring'), MS.spring);
  const original = globalThis.getComputedStyle;
  // A style read that returns seconds exercises the `s` branch without a browser.
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: () => '0.5s',
  })) as unknown as typeof getComputedStyle;
  globalThis.document = { documentElement: {} } as unknown as Document;
  try {
    assert.equal(motionMs('exit'), 500);
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: () => '  ',
    })) as unknown as typeof getComputedStyle;
    assert.equal(motionMs('exit'), MS.exit, 'blank token falls back');
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: () => 'var(--nope)',
    })) as unknown as typeof getComputedStyle;
    assert.equal(motionMs('exit'), MS.exit, 'unparseable token falls back');
  } finally {
    globalThis.getComputedStyle = original;
    Reflect.deleteProperty(globalThis, 'document');
  }
});
