/**
 * The glitch glyph, defined once for both places it is drawn.
 *
 * `src/worker/errors.ts` serves a standalone HTML string from an edge runtime with no DOM,
 * no JavaScript and no custom properties in scope, so it cannot render a component — it
 * inlines this CSS instead. The SPA's `GlitchText` injects the same string. Every colour is
 * written `var(--token, fallback)`: the SPA resolves the token from `app.css`, and the
 * Worker falls through to the identical hex. One definition, two runtimes, no drift.
 *
 * What this shares is the visual layer stack. The JS half — scramble-on-mount, the random
 * idle burst, the hover trigger — is SPA-only by construction, because the Worker page is
 * forbidden from shipping a `<script>` at all (`errors.test.ts` asserts there is none).
 *
 * This module stays free of DOM references: it is compiled into the Worker as well as the
 * SPA, so injecting the stylesheet is the caller's job.
 */

/** Hexes mirroring `web/src/app.css` `@theme`; asserted equal by `designTokens.test.ts`. */
export const GLITCH_PALETTE = {
  background: '#0a0e1a',
  foreground: '#e2e8f0',
  muted: '#7b85a0',
  primary: '#22d3ee',
} as const;

/** Ambient periods, in seconds. The two echoes never realign because these differ. */
const PERIODS = { sliceA: 2, sliceB: 2.7, jitterA: 0.35, jitterB: 0.4 } as const;

/** Displacement in px / skew in deg. The burst throws the echoes an order further. */
const JITTER = { a: { x: 6, y: 1, skew: 3 }, b: { x: 6, y: 1, skew: 3 } } as const;
const BURST = { x: 18, skew: 6, duration: 0.4 } as const;

/** The two-stop glow on the main layer — the site's only sanctioned glow (§2). */
const GLOW = { near: 10, nearAlpha: 65, far: 22, farAlpha: 35 } as const;

export const GLITCH_CSS = `
.gf {
  position: relative;
  display: inline-block;
  /* 700 is the heaviest weight either font query ships: APP_FONT_QUERY loads Inter
     400–700 and ERROR_FONT_QUERY loads 400;700 for exactly this glyph. A heavier
     declaration renders as synthetic bold on one surface or the other, and the two
     surfaces are the whole point of sharing this definition. */
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  font-family: 'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  cursor: default;
  user-select: none;
}
.gf .gf-layer {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
}
.gf .gf-main {
  position: relative;
  z-index: 3;
  color: var(--color-primary, ${GLITCH_PALETTE.primary});
  text-shadow:
    0 0 ${GLOW.near}px color-mix(in srgb, var(--color-primary, ${GLITCH_PALETTE.primary}) ${GLOW.nearAlpha}%, transparent),
    0 0 ${GLOW.far}px color-mix(in srgb, var(--color-primary, ${GLITCH_PALETTE.primary}) ${GLOW.farAlpha}%, transparent);
}
/* Both echoes stay inside the cyan ramp: the depth reads as channel separation without
   introducing a hue the palette does not define. */
.gf .gf-echo { mix-blend-mode: screen; }
.gf .gf-echo-a {
  z-index: 2;
  opacity: 0.75;
  color: var(--color-foreground, ${GLITCH_PALETTE.foreground});
  animation:
    gf-slice-a ${PERIODS.sliceA}s steps(2) infinite,
    gf-jitter-a ${PERIODS.jitterA}s steps(2) infinite;
}
.gf .gf-echo-b {
  z-index: 1;
  opacity: 0.55;
  color: var(--color-primary, ${GLITCH_PALETTE.primary});
  animation:
    gf-slice-b ${PERIODS.sliceB}s steps(2) infinite,
    gf-jitter-b ${PERIODS.jitterB}s steps(2) infinite;
}
/* A burst swaps the ambient ramps for a wide displacement ramp; each layer returns to its
   idle baseline at 100%, so dropping the class resumes ambient motion. */
.gf.gf-burst .gf-echo-a { animation: gf-burst-a ${BURST.duration}s steps(2) both; }
.gf.gf-burst .gf-echo-b { animation: gf-burst-b ${BURST.duration}s steps(2) both; }

@keyframes gf-slice-a {
  0%, 100% { clip-path: inset(15% 0 70% 0); }
  25% { clip-path: inset(65% 0 15% 0); }
  50% { clip-path: inset(35% 0 50% 0); }
  75% { clip-path: inset(75% 0 8% 0); }
}
@keyframes gf-slice-b {
  0%, 100% { clip-path: inset(68% 0 15% 0); }
  25% { clip-path: inset(15% 0 65% 0); }
  50% { clip-path: inset(52% 0 32% 0); }
  75% { clip-path: inset(8% 0 78% 0); }
}
@keyframes gf-jitter-a {
  0%, 100% { transform: translate(-2px, 0); }
  40% { transform: translate(-${JITTER.a.x}px, ${JITTER.a.y}px) skewX(-${JITTER.a.skew}deg); }
  70% { transform: translate(4px, 0); }
}
@keyframes gf-jitter-b {
  0%, 100% { transform: translate(2px, 0); }
  40% { transform: translate(${JITTER.b.x}px, -${JITTER.b.y}px) skewX(${JITTER.b.skew}deg); }
  70% { transform: translate(-4px, 0); }
}
@keyframes gf-burst-a {
  0% { transform: translate(-2px, 0); clip-path: inset(0 0 0 0); }
  15% { transform: translate(-${BURST.x}px, 0) skewX(-${BURST.skew}deg); clip-path: inset(10% 0 70% 0); }
  30% { transform: translate(16px, 0) skewX(5deg); clip-path: inset(60% 0 20% 0); }
  45% { transform: translate(-14px, 0) skewX(-4deg); clip-path: inset(30% 0 50% 0); }
  60% { transform: translate(17px, 0) skewX(6deg); clip-path: inset(75% 0 10% 0); }
  75% { transform: translate(-9px, 0); clip-path: inset(45% 0 35% 0); }
  100% { transform: translate(-2px, 0); clip-path: inset(0 0 0 0); }
}
@keyframes gf-burst-b {
  0% { transform: translate(2px, 0); clip-path: inset(0 0 0 0); }
  15% { transform: translate(${BURST.x}px, 0) skewX(${BURST.skew}deg); clip-path: inset(70% 0 15% 0); }
  30% { transform: translate(-16px, 0) skewX(-5deg); clip-path: inset(20% 0 60% 0); }
  45% { transform: translate(14px, 0) skewX(4deg); clip-path: inset(50% 0 30% 0); }
  60% { transform: translate(-17px, 0) skewX(-6deg); clip-path: inset(10% 0 75% 0); }
  75% { transform: translate(9px, 0); clip-path: inset(35% 0 45% 0); }
  100% { transform: translate(2px, 0); clip-path: inset(0 0 0 0); }
}
/* Reduced motion keeps the glyph readable and drops the displacement entirely, rather than
   freezing a mid-glitch frame. */
@media (prefers-reduced-motion: reduce) {
  .gf .gf-echo { display: none; }
  .gf .gf-main { text-shadow: none; }
}
`;
