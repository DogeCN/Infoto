// Device capability signals that change behaviour: whether the primary pointer can hover, and
// whether the user asked for reduced motion. Not `media` — in this repo that word means photo
// and video artifacts (`src/shared/media.ts`); these are input and preference queries.
//
// This is deliberately not one `isMobile` flag. Hover capability, a component's rendered
// form and the motion preference answer independent questions — a narrow desktop window has
// a hovering pointer while the upload panel is a full-width sheet, and a wide tablet has no
// hover at all. Folding them together is how the panel once rendered the mobile form without
// its chevron. Responsive form stays measured per component (or expressed in `md:` CSS);
// this module owns only the two media queries whose answer changes what code does.

const HOVER_QUERY = '(hover: hover)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(query: string): MediaQueryList | undefined {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia(query);
}

const hoverQuery = mediaQuery(HOVER_QUERY);
let hoverCapable = $state(hoverQuery?.matches ?? false);
hoverQuery?.addEventListener('change', (event) => {
  hoverCapable = event.matches;
});

/**
 * Whether the primary input can hover. Reading it inside a `$derived` subscribes that
 * computation, so a hybrid device that gains or loses a mouse updates the controls that
 * branch on it.
 */
export function canHover(): boolean {
  return hoverCapable;
}

const reducedMotionQuery = mediaQuery(REDUCED_MOTION_QUERY);

/**
 * The motion preference at the moment of the call. A JS-driven animation (WAAPI, Svelte
 * transition params, timers) cannot see the global CSS rule that only shortens CSS
 * transitions, so it must ask explicitly.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}
