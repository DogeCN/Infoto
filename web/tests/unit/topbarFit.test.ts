// Top-bar density resolution — `vitest run` (root).
//
// The regression this locks down: the bar used to hide the sort labels from a Tailwind
// breakpoint (`hidden sm:inline`), which asks "how wide is the viewport" instead of "is
// the pill squeezed". On a 320px phone that hid labels while there was still room, and
// on a wide window a long translation hid them while nothing was tight. The decision now
// comes from measured widths, and the ordering is the contract: ground is given up one
// step at a time, and the arrow appears only after the labels are already gone.

import { describe, expect, it } from 'vitest';
import { barPadX, resolveBarMode } from '../../src/lib/components/topbarFit';

/** Representative content widths (px-3.5 px-2 p-1 py-1.5 + size-4/size-5 icons),
 *  i.e. the same classes the real controls use:
 *    pill  — 3 segments: labelled ≈ 258 (icon + 2 CJK chars), icon-only ≈ 156
 *    left  — settings + sync, two 36px buttons
 *    right — announcements + select + upload, three 36px buttons
 *  Only the *ordering* they encode is contractual; the exact numbers just have to be
 *  realistic enough that the phone case lands where it does in practice. */
const FULL = 258;
const COMPACT = 156;
const LEFT = 76;
const RIGHT = 116;
const GAP = 4;
const PAD = 24; // px-3 × 2
const REQ = {
  full: PAD + FULL + GAP + LEFT + RIGHT,
  compact: PAD + COMPACT + GAP + LEFT + RIGHT,
  paged: Math.max(PAD + COMPACT + GAP + LEFT, PAD + 36 + GAP + RIGHT),
};

describe('top bar density', () => {
  it('shows labels when everything fits', () => {
    expect(resolveBarMode(1000, REQ)).toBe('full');
    expect(resolveBarMode(REQ.full, REQ)).toBe('full');
  });

  it('hides the labels exactly when the labelled form stops fitting', () => {
    // One pixel narrower than `full` needs: the pill is squeezed, so it must drop labels.
    expect(resolveBarMode(REQ.full - 1, REQ)).toBe('compact');
  });

  it('pages only after the icon-only form also stops fitting', () => {
    // This is the ordering the user asked for: the arrow must not appear while the
    // labels could still be shown.
    expect(resolveBarMode(REQ.compact, REQ)).toBe('compact');
    expect(resolveBarMode(REQ.compact - 1, REQ)).toBe('paged');
  });

  it('keeps the roomiest layout before the bar is measured', () => {
    // available <= 0 means "not measured yet". `full` is the only mode that cannot
    // overflow, so a pre-measurement frame is harmless; guessing low would flash the
    // arrow at every user who never needs it.
    expect(resolveBarMode(0, REQ)).toBe('full');
    expect(resolveBarMode(-1, REQ)).toBe('full');
    expect(resolveBarMode(NaN, REQ)).toBe('full');
  });

  it('the phone viewport lands in the expected mode for each step', () => {
    // 1080 physical px at density 540 → a 320 CSS-px viewport. With the widths above
    // this is genuinely too narrow even for the icon-only single screen, which is why
    // the arrow exists at all.
    expect(resolveBarMode(320, REQ)).toBe('paged');
    // Given a roomier phone-class bar the same function degrades one step at a time.
    expect(resolveBarMode(REQ.full, REQ)).toBe('full');
    expect(resolveBarMode(REQ.compact, REQ)).toBe('compact');
  });

  it('a desktop bar stays labelled', () => {
    expect(resolveBarMode(1280, REQ)).toBe('full');
    expect(resolveBarMode(768, REQ)).toBe('full');
  });
});

describe('bar padding', () => {
  it('matches the px-3 md:px-6 classes', () => {
    expect(barPadX(320)).toBe(12);
    expect(barPadX(767)).toBe(12);
    expect(barPadX(768)).toBe(24);
    expect(barPadX(1440)).toBe(24);
  });
});
