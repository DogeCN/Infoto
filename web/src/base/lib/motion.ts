/**
 * Motion tokens mirrored from `app.css`.
 *
 * Web Animations, Svelte transitions and JS timers cannot read a CSS custom property,
 * so they would otherwise re-type the numbers in `app.css` and drift from it. These
 * helpers resolve the tokens from the document and fall back to the values already
 * declared there when there is no DOM (server render, unit tests).
 *
 * Callers pass a phase, never a property name: the `--duration-` / `--ease-` prefixes
 * are added here exactly once, and the fallback travels alongside the property so a
 * lookup can never miss.
 */

import { clamp01 } from './num.ts';

/** `enter` runs when something appears, `exit` when it leaves, `spring` for bouncy motion. */
export type MotionPhase = 'enter' | 'exit' | 'spring';

type MotionProperty = `--duration-${MotionPhase}` | `--ease-${MotionPhase}`;

/** Fallbacks mirror the `@theme` block in `app.css`; keep the two in step. */
const FALLBACK_MS: Record<MotionPhase, number> = { enter: 280, exit: 160, spring: 420 };
const FALLBACK_EASE: Record<MotionPhase, string> = {
  enter: 'cubic-bezier(0.2, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

/** Resolve one motion custom property, falling back to its declared value. */
export function motionToken(property: MotionProperty, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return value || fallback;
}

/** One phase's duration in milliseconds, for `element.animate()` and `setTimeout`. */
export function motionMs(phase: MotionPhase): number {
  const raw = motionToken(`--duration-${phase}`, `${FALLBACK_MS[phase]}ms`);
  const match = /^(-?[\d.]+)(s|ms)$/.exec(raw);
  if (!match) return FALLBACK_MS[phase];
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

/** The easing token as a CSS timing function string, for WAAPI and inline styles. */
export function motionEase(phase: MotionPhase): string {
  return motionToken(`--ease-${phase}`, FALLBACK_EASE[phase]);
}

/** Solve the CSS cubic-bezier timing function for progress `x`, as Svelte's easing API wants. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  // Standard cubic Bézier with control points 0, (a, b), 1: P0=0, P1=a, P2=b, P3=1.
  const bezier = (a: number, b: number, t: number): number =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  const slope = (a: number, b: number, t: number): number =>
    3 * ((1 - t) ** 2 * a + 2 * (1 - t) * t * (b - a) + t * t * (1 - b));

  /** Invert the x-polynomial: find the curve parameter that yields progress `x`. */
  const parameterFor = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, t);
      if (d === 0) break;
      t = clamp01(t - (bezier(x1, x2, t) - x) / d);
    }
    return t;
  };

  // One parameter drives both axes: y is evaluated at the parameter x resolves to, not
  // solved again — solving y independently would fold the curve back through a linear
  // map and silently drop any overshoot.
  return (x: number): number => (x <= 0 || x >= 1 ? x : bezier(y1, y2, parameterFor(x)));
}

/** An easing token as a Svelte `EasingFunction`, derived from the token's cubic-bezier. */
export function motionEaseFn(phase: MotionPhase): (t: number) => number {
  const match = /cubic-bezier\(([^)]+)\)/.exec(motionEase(phase));
  const parts = match?.[1].split(',').map(Number);
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return (t) => t;
  }
  return cubicBezier(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

/** Shared `transition:fly` params for the slider value bubble. */
export const bubbleTransition = {
  y: 3,
  duration: motionMs('exit'),
  easing: motionEaseFn('exit'),
};
