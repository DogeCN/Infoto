// The site-wide playback level for every `<video>`, shared by the settings slider and the
// three surfaces that render video (a waterfall card, the Lightbox, rendered Markdown).
//
// The level is a preference, not element state: it never unmutes anything, because a
// muted autoplay element is the only kind browsers will start.

import { clamp } from '$base/lib/num';

/** Playback volume, 0…1. One owner: no component keeps its own copy. */
export const playbackVolume = $state({ value: 1 });

/** Set the shared volume, clamped to 0…1; a non-finite input leaves the current value. */
export function setPlaybackVolume(value: number): void {
  if (!Number.isFinite(value)) return;
  playbackVolume.value = clamp(value, 0, 1);
}

/** The surfaces that can render a video. Only one of them may sound at a time. */
export type AudioSurface = 'grid' | 'lightbox' | 'markdown';

/**
 * The media whose sound is **open** (by URL), and which render currently owns it.
 *
 * One owner for the whole page, not one flag per element: unmuting anywhere closes whatever
 * else was open, and the same photo therefore reads the same state in the waterfall and in the
 * Lightbox.
 *
 * The `surface` is which *render* may unmute its own element. It is not the identity of the
 * open sound — the media can be rendered twice at once (the grid card behind an open viewer)
 * and only one element may be unmuted, or the same audio plays twice, out of phase. Keeping
 * the two apart is what lets the viewer open and close **without tearing the sound down**:
 * ownership moves from one render to the other while `url` never changes, so no audio stream
 * is started and stopped, and the card behind the viewer never falls silent.
 */
export const audio = $state<{ url: string | null; surface: AudioSurface | null }>({
  url: null,
  surface: null,
});

/** True when `url` is the open media, on ANY surface rendering it. */
export function isAudioMediaOpen(url: string | null | undefined): boolean {
  return url != null && audio.url === url;
}

/** True when `url` is open AND this surface is the render allowed to unmute its element. */
export function isAudioOpen(url: string | null | undefined, surface: AudioSurface): boolean {
  return url != null && audio.url === url && audio.surface === surface;
}

/** Open `url` on `surface`, or close it when that same media already holds the sound. */
export function toggleAudio(url: string, surface: AudioSurface): void {
  if (audio.url === url && audio.surface === surface) {
    closeAudio();
    return;
  }
  audio.url = url;
  audio.surface = surface;
}

/**
 * Move the ownership of the SAME open media to another render (the viewer taking over a
 * sounding card, or handing it back on close). Nothing is started or stopped: `url` is
 * untouched, so there is no audible gap. A different media is left alone — opening another
 * photo must not silence the one the user chose.
 */
export function claimAudio(surface: AudioSurface, url?: string): void {
  if (audio.url === null) return;
  if (url !== undefined && audio.url !== url) return;
  audio.surface = surface;
}

/** Close whatever is open. */
export function closeAudio(): void {
  audio.url = null;
  audio.surface = null;
}

/** A surface that unmounts gives up the sound only while it still owns it. */
export function releaseAudio(url: string, surface: AudioSurface): void {
  if (audio.url === url && audio.surface === surface) closeAudio();
}
