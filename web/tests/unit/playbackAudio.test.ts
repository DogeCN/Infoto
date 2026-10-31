import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  audio,
  claimAudio,
  closeAudio,
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
