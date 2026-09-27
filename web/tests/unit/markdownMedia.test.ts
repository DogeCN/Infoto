import { describe, expect, it } from 'vitest';
import { isAnimatedArtifact } from '../../src/lib/components/markdownMedia';

describe('isAnimatedArtifact', () => {
  it('treats a .webm path as animated and ignores everything else', () => {
    expect(isAnimatedArtifact('https://host/a.webm')).toBe(true);
    expect(isAnimatedArtifact('https://host/A.WEBM')).toBe(true);
    expect(isAnimatedArtifact('https://host/a.webm?v=2#t=1')).toBe(true);
    expect(isAnimatedArtifact('/static/a.webm')).toBe(true);
    expect(isAnimatedArtifact('a.webm')).toBe(true);
    expect(isAnimatedArtifact('https://host/a.webp')).toBe(false);
    expect(isAnimatedArtifact('https://host/a.png')).toBe(false);
    expect(isAnimatedArtifact('https://host/download?file=a.webm')).toBe(false);
    expect(isAnimatedArtifact('not a url')).toBe(false);
    expect(isAnimatedArtifact(null)).toBe(false);
    expect(isAnimatedArtifact(undefined)).toBe(false);
    expect(isAnimatedArtifact('')).toBe(false);
  });
});
