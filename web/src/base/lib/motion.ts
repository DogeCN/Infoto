/**
 * Motion tokens mirrored from `app.css`.
 *
 * Web Animations, Svelte transitions and JS timers cannot read a CSS custom property,
 * so they would otherwise re-type the numbers in `app.css` and drift from it. These
 * helpers resolve the tokens once from the document and fall back to the values already
 * declared there when there is no DOM (server render, unit tests).
 */

import { clamp01 } from './num.ts';

/** Fallbacks mirror the `@theme` block in `app.css`; keep the two in step. */
const FALLBACK: Record<string, string> = {
  '--duration-enter': '280ms',
  '--duration-exit': '160ms',
  '--duration-spring': '420ms',
  '--ease-enter': 'cubic-bezier(0.2, 0, 0, 1)',
  '--ease-exit': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  '--ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const UNIT_MS: Record<string, number> = { s: 1000, ms: 1 };

/** Resolve one motion custom property, falling back to its declared value. */
export function motionToken(name: keyof typeof FALLBACK): string {
  const fallback = FALLBACK[name];
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** One token as a millisecond count, for `element.animate()` and `setTimeout`. */
export function motionMs(name: 'duration-enter' | 'duration-exit' | 'duration-spring'): number {
  const raw = motionToken(`--duration-${name}`);
  const match = /^(-?[\d.]+)(s|ms)$/.exec(raw);
  return match
    ? Number(match[1]) * UNIT_MS[match[2]]!
    : Number(FALLBACK[`--duration-${name}`]!.slice(0, -2));
}

/** The easing token as a CSS timing function string, for WAAPI and Svelte transitions. */
export function motionEase(name: 'enter' | 'exit' | 'spring'): string {
  return motionToken(`--ease-${name}`);
}

/** Solve the CSS cubic-bezier timing function for progress `t`, as Svelte's easing API wants. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const curve = (a: number, b: number) => (u: number) => {
    // Newton iteration on the x-polynomial; `u` is the x that yields parameter `a`.
    let guess = u;
    for (let i = 0; i < 8; i++) {
      const slope = 3 * (1 - u) ** 2 * a + 6 * (1 - u) * u * (b - a) + 3 * u ** 2 * (1 - b);
      if (slope === 0) break;
      const current = 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * (b - a) + u ** 3;
      guess -= (current - u) / slope;
      guess = clamp01(guess);
    }
    return guess;
  };
  const sampleX = curve(x1, x2);
  const sampleY = curve(y1, y2);
  return (t: number): number => (t <= 0 || t >= 1 ? t : sampleY(sampleX(t)));
}

/** An easing token as a Svelte `EasingFunction`, derived from the token's cubic-bezier. */
export function motionEaseFn(name: 'enter' | 'exit' | 'spring'): (t: number) => number {
  const match = /cubic-bezier\(([^)]+)\)/.exec(motionEase(name));
  const parts = match?.[1].split(',').map(Number);
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return (t) => t;
  }
  return cubicBezier(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

/** Shared `transition:fly` params for the slider value bubble. */
export const bubbleTransition = {
  y: 3,
  duration: motionMs('duration-exit'),
  easing: motionEaseFn('exit'),
};
