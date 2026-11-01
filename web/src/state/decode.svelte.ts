// Which media URLs have already been decoded somewhere on this page.
//
// The waterfall card and the Lightbox are two renders of the same photo, and each keeps its
// own `<img>`/`<video>` with its own load event. Without a shared record, one surface knows a
// photo is ready while the other still believes it is cold: the viewer opened instantly over
// a card that had never decoded, closed, and left the card painting a skeleton for media the
// page had already shown. That is the bug this module exists to prevent.
//
// It is deliberately NOT a cache of pixels — the browser's HTTP cache already owns those.
// It records only "this URL has decoded once on this page", which is the single fact both
// surfaces need to agree on. A URL that is still cold on both is unchanged: each surface
// shows its own skeleton until its own element fires.

import type { MediaType } from '$shared/types';

/** URLs known to have decoded at least one image or video element on this page. */
const decoded = new Set<string>();

/** Reactive version counter, so a surface can re-derive when the record changes. Svelte's
 *  reactivity does not see a plain `Set`, and a deep store would re-render every card on
 *  every decode — the counter is the cheapest signal that something changed. */
export const decodedEpoch = $state({ value: 0 });

/** True when this URL has decoded somewhere on the page. */
export function hasDecoded(url: string | null | undefined): boolean {
  void decodedEpoch.value; // tracked: a decode elsewhere must re-evaluate the caller
  return url != null && decoded.has(url);
}

/** Record that `url` decoded. Idempotent; only a new URL bumps the epoch. */
export function markDecoded(url: string | null | undefined): void {
  if (url == null || url === '' || decoded.has(url)) return;
  decoded.add(url);
  decodedEpoch.value += 1;
}

/** Drop a URL that failed to load, so the failure path is re-entered rather than cached. */
export function forgetDecoded(url: string | null | undefined): void {
  if (url == null || !decoded.has(url)) return;
  decoded.delete(url);
  decodedEpoch.value += 1;
}

/** Re-exported for callers that switch their dismiss control by media kind. */
export type { MediaType };
