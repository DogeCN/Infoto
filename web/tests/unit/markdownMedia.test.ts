import { describe, expect, it } from 'vitest';
import { isAnimatedArtifact } from '../../src/lib/components/markdownMedia';

// Markdown only carries a URL, so the artifact extension decides whether a
// rendered image must become a <video> (GIF / video → VP9 WebM).

describe('isAnimatedArtifact', () => {
  it('treats .webm artifacts as animated', () => {
    expect(isAnimatedArtifact('https://host/a.webm')).toBe(true);
    expect(isAnimatedArtifact('https://host/A.WEBM')).toBe(true);
  });

  it('leaves still images alone', () => {
    expect(isAnimatedArtifact('https://host/a.webp')).toBe(false);
    expect(isAnimatedArtifact('https://host/a.png')).toBe(false);
  });

  it('ignores query strings and fragments when reading the extension', () => {
    expect(isAnimatedArtifact('https://host/a.webm?v=2#t=1')).toBe(true);
    // An extension that only appears in the query must not count.
    expect(isAnimatedArtifact('https://host/download?file=a.webm')).toBe(false);
  });

  it('handles relative and malformed URLs without throwing', () => {
    expect(isAnimatedArtifact('/static/a.webm')).toBe(true);
    expect(isAnimatedArtifact('a.webm')).toBe(true);
    expect(isAnimatedArtifact('not a url')).toBe(false);
    expect(isAnimatedArtifact(null)).toBe(false);
    expect(isAnimatedArtifact(undefined)).toBe(false);
    expect(isAnimatedArtifact('')).toBe(false);
  });
});
