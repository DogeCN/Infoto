import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  audio,
  claimAudio,
  closeAudio,
  isAudioMediaOpen,
  isAudioOpen,
  releaseAudio,
  toggleAudio,
} from '../../src/state/playback.svelte';

// The store is module-level state shared by the page, so every case starts from silence.
const silence = () => closeAudio();

test('toggleAudio: opening a second media closes the first', () => {
  silence();
  toggleAudio('a', 'grid');
  assert.equal(isAudioOpen('a', 'grid'), true);
  assert.equal(isAudioOpen('b', 'grid'), false);

  toggleAudio('b', 'grid');
  assert.equal(isAudioOpen('a', 'grid'), false, 'the previous card must go quiet');
  assert.equal(isAudioOpen('b', 'grid'), true);
  assert.deepEqual({ ...audio }, { url: 'b', surface: 'grid' });
  silence();
});

test('toggleAudio: the same element toggles closed and another surface can adopt the media', () => {
  silence();
  toggleAudio('a', 'grid');
  toggleAudio('a', 'grid');
  assert.deepEqual({ ...audio }, { url: null, surface: null });

  // The viewer takes the same media over from the card: the state is shared, the player is
  // not — the card behind the overlay must go quiet while the viewer holds the sound.
  toggleAudio('a', 'grid');
  claimAudio('lightbox');
  assert.deepEqual({ ...audio }, { url: 'a', surface: 'lightbox' });
  assert.equal(isAudioOpen('a', 'grid'), false);
  assert.equal(isAudioOpen('a', 'lightbox'), true);

  // Closing the viewer hands it back, so the two surfaces never disagree about the photo.
  claimAudio('grid');
  assert.equal(isAudioOpen('a', 'grid'), true);
  silence();
});

test('claimAudio only moves an open sound', () => {
  silence();
  claimAudio('grid');
  assert.deepEqual({ ...audio }, { url: null, surface: null });
  toggleAudio('a', 'grid');
  claimAudio('markdown');
  assert.deepEqual({ ...audio }, { url: 'a', surface: 'markdown' });
  silence();
});

test('releaseAudio closes only the media its own surface owned', () => {
  silence();
  toggleAudio('a', 'grid');
  releaseAudio('b', 'grid');
  releaseAudio('a', 'markdown');
  assert.equal(isAudioOpen('a', 'grid'), true, 'another surface release must not silence it');
  releaseAudio('a', 'grid');
  assert.deepEqual({ ...audio }, { url: null, surface: null });
});

test('isAudioOpen ignores media without a URL', () => {
  silence();
  assert.equal(isAudioOpen(undefined, 'grid'), false);
  assert.equal(isAudioOpen(null, 'grid'), false);
  assert.equal(isAudioOpen('', 'grid'), false);
});

test('opening the viewer keeps the media open and the card playing underneath', () => {
  // The reported bug: muting a card, opening it, and the audio gapped on both transitions.
  // Ownership moves between the two renders, but the media itself must never close, because
  // the card keeps playing it and is only muted while the viewer holds the right.
  silence();
  toggleAudio('a', 'grid');
  claimAudio('lightbox', 'a');
  assert.equal(audio.url, 'a', 'the media stays open across the transition');
  assert.equal(isAudioMediaOpen('a'), true, 'the card keeps playing it (muted, not paused)');
  assert.equal(isAudioOpen('a', 'grid'), false, 'only the viewer may be unmuted');
  assert.equal(isAudioOpen('a', 'lightbox'), true);

  claimAudio('grid', 'a');
  assert.equal(audio.url, 'a', 'closing the viewer must not restart the audio');
  assert.equal(isAudioOpen('a', 'grid'), true);
  silence();
});

test('opening another media leaves an open sound alone', () => {
  // Browsing must not silence audio the user deliberately opened: the viewer opening on a
  // DIFFERENT photo does not adopt and does not close the open one.
  silence();
  toggleAudio('a', 'grid');
  claimAudio('lightbox', 'b');
  assert.deepEqual({ ...audio }, { url: 'a', surface: 'grid' });
  assert.equal(isAudioMediaOpen('a'), true);
  silence();
});
