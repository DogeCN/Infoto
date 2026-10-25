// The site-wide playback level for every `<video>`, shared by the settings slider and
// the three surfaces that render video (a waterfall card, the Lightbox, rendered Markdown).
//
// The level is a preference, not element state: it never unmutes anything, because a
// muted autoplay element is the only kind browsers will start. Each component therefore
// keeps its own mute toggle and reads this one value for `volume`.

import { clamp } from '$base/lib/num';

/** Playback volume, 0…1. One owner: no component keeps its own copy. */
export const playbackVolume = $state({ value: 1 });

/** Set the shared volume, clamped to 0…1; a non-finite input leaves the current value. */
export function setPlaybackVolume(value: number): void {
  if (!Number.isFinite(value)) return;
  playbackVolume.value = clamp(value, 0, 1);
}
